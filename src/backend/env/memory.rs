use ic_cdk::api::stable::{stable64_grow, stable64_read, stable64_size, stable64_write};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{cell::RefCell, collections::BTreeMap, fmt::Display, rc::Rc};

use super::post::PostId;

#[derive(Serialize, Deserialize)]
pub struct Api {
    allocator: Allocator,
    #[allow(clippy::type_complexity)]
    #[serde(skip)]
    write_bytes: Option<Box<dyn Fn(u64, &[u8])>>,
    #[allow(clippy::type_complexity)]
    #[serde(skip)]
    read_bytes: Option<Box<dyn Fn(u64, &mut [u8])>>,
}

impl Clone for Api {
    fn clone(&self) -> Self {
        Self {
            allocator: self.allocator.clone(),
            ..Default::default()
        }
    }
}

impl Default for Api {
    fn default() -> Self {
        Self {
            allocator: Default::default(),
            write_bytes: Some(Box::new(stable64_write)),
            read_bytes: Some(Box::new(stable64_read)),
        }
    }
}

#[derive(Default, Serialize, Deserialize)]
pub struct Memory {
    api: Api,
    pub posts: ObjectManager<PostId>,
    #[serde(default)]
    pub ledger: ObjectManager<u64>,
    #[serde(skip)]
    api_ref: Rc<RefCell<Api>>,
}

// We leave the first 16 bytes recerved for the heap coordinates (offset + length)
const INITIAL_OFFSET: u64 = 16;

impl Api {
    pub fn write<T: Serialize>(&mut self, value: &T) -> Result<(u64, u64), String> {
        let buffer: Vec<u8> = serde_cbor::to_vec(value).expect("couldn't serialize");
        let offset = self.allocator.alloc(buffer.len() as u64)?;
        (self.write_bytes.as_ref().expect("no writer"))(offset, &buffer);
        Ok((offset, buffer.len() as u64))
    }

    pub fn remove(&mut self, offset: u64, len: u64) -> Result<(), String> {
        self.allocator.free(offset, len)
    }

    pub fn read<T: DeserializeOwned>(&self, offset: u64, len: u64) -> T {
        let mut bytes = Vec::with_capacity(len as usize);
        bytes.spare_capacity_mut();
        unsafe {
            bytes.set_len(len as usize);
        }
        (self.read_bytes.as_ref().expect("no reader"))(offset, &mut bytes);
        serde_cbor::from_slice(&bytes).expect("couldn't deserialize")
    }

    pub fn boundary(&self) -> u64 {
        self.allocator.boundary
    }
}

impl Memory {
    pub fn set_block_size(&mut self, n: u64) {
        ic_cdk::println!(
            "old allocation block size: {}",
            self.api_ref.borrow().allocator.block_size_bytes
        );
        self.api_ref.borrow_mut().allocator.block_size_bytes = n;
        ic_cdk::println!(
            "new allocation block size: {}",
            self.api_ref.borrow().allocator.block_size_bytes
        );
    }

    pub fn health(&self, unit: &str) -> String {
        self.api_ref.as_ref().borrow().allocator.health(unit)
    }

    fn pack(&mut self) {
        self.api = (*self.api_ref.as_ref().borrow()).clone();
    }

    fn unpack(&mut self) {
        self.api_ref = Rc::new(RefCell::new(self.api.clone()));
        self.posts.api = Rc::clone(&self.api_ref);
    }

    #[allow(clippy::type_complexity)]
    #[cfg(test)]
    pub fn set_test_api(
        &mut self,
        mem_grow: Box<dyn FnMut(u64) -> Result<u64, String>>,
        mem_end: Box<dyn Fn() -> u64>,
        write_bytes: Box<dyn Fn(u64, &[u8])>,
        read_bytes: Box<dyn Fn(u64, &mut [u8])>,
    ) {
        let allocator = Allocator {
            block_size_bytes: 1,
            segments: Default::default(),
            mem_grow: Some(mem_grow),
            mem_size: Some(mem_end),
            boundary: 16,
        };
        let test_api = Api {
            allocator,
            write_bytes: Some(write_bytes),
            read_bytes: Some(read_bytes),
        };
        self.api_ref = Rc::new(RefCell::new(test_api));
        self.posts.api = Rc::clone(&self.api_ref);
    }
}

pub fn heap_to_stable(state: &mut super::State) {
    state.memory.pack();
    let offset = state.memory.api.boundary();
    let bytes = serde_cbor::to_vec(&state).expect("couldn't serialize the state");
    let len = bytes.len() as u64;
    if offset + len > (stable64_size() << 16) {
        stable64_grow((len >> 16) + 1).expect("couldn't grow memory");
    }
    stable64_write(offset, &bytes);
    stable64_write(0, &offset.to_be_bytes());
    stable64_write(8, &len.to_be_bytes());
}

pub fn heap_address() -> (u64, u64) {
    let mut offset_bytes: [u8; 8] = Default::default();
    stable64_read(0, &mut offset_bytes);
    let offset = u64::from_be_bytes(offset_bytes);
    let mut len_bytes: [u8; 8] = Default::default();
    stable64_read(8, &mut len_bytes);
    let len = u64::from_be_bytes(len_bytes);
    (offset, len)
}

pub fn stable_to_heap() -> super::State {
    let (offset, len) = heap_address();
    ic_cdk::println!("Reading heap from coordinates: {:?}", (offset, len));
    let api = Api::default();
    let mut state: super::State = api.read(offset, len);
    state.memory.unpack();
    state
}

#[derive(Serialize, Deserialize)]
struct Allocator {
    // The smallest amount of space that can be allocated.
    #[serde(default)]
    block_size_bytes: u64,
    // Mapping of free segments: offset -> length
    segments: BTreeMap<u64, u64>,
    boundary: u64,
    #[serde(skip)]
    #[allow(clippy::type_complexity)]
    mem_grow: Option<Box<dyn FnMut(u64) -> Result<u64, String>>>,
    #[serde(skip)]
    mem_size: Option<Box<dyn Fn() -> u64>>,
}

impl Clone for Allocator {
    fn clone(&self) -> Self {
        Self {
            segments: self.segments.clone(),
            boundary: self.boundary,
            ..Default::default()
        }
    }
}

impl Default for Allocator {
    fn default() -> Self {
        Self {
            block_size_bytes: 200,
            segments: Default::default(),
            boundary: INITIAL_OFFSET,
            mem_size: Some(Box::new(|| stable64_size() << 16)),
            mem_grow: Some(Box::new(|n| {
                stable64_grow((n >> 16) + 1)
                    .map_err(|err| format!("couldn't grow memory: {:?}", err))
            })),
        }
    }
}

impl Allocator {
    fn get_allocation_length(&self, n: u64) -> u64 {
        (n + self.block_size_bytes - 1) / self.block_size_bytes * self.block_size_bytes
    }

    fn alloc(&mut self, len: u64) -> Result<u64, String> {
        let n = self.get_allocation_length(len);
        // find all segments that are big enough
        let mut candidates = BTreeMap::new();
        for (start, size) in self.segments.iter() {
            if size >= &n {
                candidates.insert(size, start);
            }
            if size == &n {
                break;
            }
        }
        let (start, new_segment) = match candidates.first_key_value() {
            // get the smallest segment from the candidates
            Some((size, start)) => (
                **start,
                // if the segment is larger, create a new rest segment
                (n < **size).then_some((**start + n, **size - n)),
            ),
            // if no large enough segments exist, grow the memory
            _ => {
                let boundary = self.boundary;
                self.boundary += n;
                if self.boundary >= (self.mem_size.as_ref().unwrap())() {
                    (self.mem_grow.as_mut().unwrap())(n)?;
                }
                (boundary, None)
            }
        };
        self.segments.remove(&start);
        if let Some((start, size)) = new_segment {
            self.segments.insert(start, size);
        }
        Ok(start)
    }

    fn free(&mut self, offset: u64, len: u64) -> Result<(), String> {
        let size = self.get_allocation_length(len);
        let left_segment = self.segments.range(..offset).last().map(|(a, b)| (*a, *b));
        let right_segment = self
            .segments
            .range(offset + size..)
            .next()
            .map(|(a, b)| (*a, *b));
        match (left_segment, right_segment) {
            (_, Some((r_start, r_size))) if offset + size > r_start => {
                return Err(format!(
                    "right segment {:?} overlaps with deallocating {:?}",
                    (r_start, r_size),
                    (offset, size)
                ))
            }
            (Some((l_start, l_size)), _) if l_start + l_size > offset => {
                return Err(format!(
                    "left segment {:?} overlaps with deallocating {:?}",
                    (l_start, l_size),
                    (offset, size)
                ))
            }
            (Some((l_start, l_size)), Some((r_start, r_size)))
                if l_start + l_size == offset && offset + size == r_start =>
            {
                self.segments
                    .remove(&l_start)
                    .ok_or("no left segment found")?;
                self.segments
                    .remove(&r_start)
                    .ok_or("no right segment found")?;
                self.segments.insert(l_start, l_size + size + r_size);
            }
            (_, Some((r_start, r_size))) if offset + size == r_start => {
                self.segments
                    .remove(&r_start)
                    .ok_or("no right segment found")?;
                self.segments.insert(offset, size + r_size);
            }
            (Some((l_start, l_size)), _) if l_start + l_size == offset => {
                self.segments
                    .insert(l_start, l_size + size)
                    .ok_or("no left segment found")?;
            }
            _ => {
                self.segments.insert(offset, size);
            }
        }
        Ok(())
    }

    fn health(&self, unit: &str) -> String {
        let divisor = match unit {
            "KB" => 1024,
            "MB" => 1024 * 1024,
            _ => 1,
        };
        format!(
            "boundary={}{2}, mem_size={}{2}, segments={3}",
            self.boundary / divisor,
            self.mem_size.as_ref().map(|f| f()).unwrap_or_default() / divisor,
            unit,
            &self.segments.len(),
        )
    }

    #[cfg(test)]
    fn segs(&self) -> usize {
        self.segments.len()
    }

    #[cfg(test)]
    fn seg(&self, start: u64) -> u64 {
        self.segments.get(&start).copied().expect("no segment")
    }
}

#[derive(Default, Serialize, Deserialize)]
pub struct ObjectManager<K: Ord + Eq> {
    index: BTreeMap<K, (u64, u64)>,
    #[serde(skip)]
    api: Rc<RefCell<Api>>,
}

impl<K: Eq + Ord + Clone + Display> ObjectManager<K> {
    pub fn len(&self) -> usize {
        self.index.len()
    }

    pub fn insert<T: Serialize>(&mut self, id: K, value: T) -> Result<(), String> {
        self.index.insert(id, self.api.borrow_mut().write(&value)?);
        Ok(())
    }

    pub fn get<T: DeserializeOwned>(&self, id: &K) -> Option<T> {
        self.index
            .get(id)
            .map(|(offset, len)| self.api.borrow().read(*offset, *len))
    }

    pub fn iter<T: DeserializeOwned>(&self) -> Box<dyn DoubleEndedIterator<Item = (K, T)> + '_> {
        Box::new(
            self.index
                .keys()
                .map(move |id| (id.clone(), self.get(id).expect("no persisted value"))),
        )
    }

    pub fn remove<T: DeserializeOwned>(&mut self, id: &K) -> Result<T, String> {
        let (offset, len) = self.index.remove(id).ok_or("not found")?;
        let value = self.api.borrow().read(offset, len);
        self.api.borrow_mut().remove(offset, len)?;
        Ok(value)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn test_allocation_size() {
        let a = Allocator::default();
        assert_eq!(a.block_size_bytes, 200);
        assert_eq!(a.get_allocation_length(0), 0);
        assert_eq!(a.get_allocation_length(1), 200);
        assert_eq!(a.get_allocation_length(100), 200);
        assert_eq!(a.get_allocation_length(199), 200);
        assert_eq!(a.get_allocation_length(200), 200);
        assert_eq!(a.get_allocation_length(201), 400);
        assert_eq!(a.get_allocation_length(301), 400);
        assert_eq!(a.get_allocation_length(400), 400);
    }

    #[test]
    fn test_allocator() {
        static mut MEM_END: u64 = 16;
        let mem_grow = |n| unsafe {
            MEM_END += n;
            Ok(0)
        };
        fn mem_end() -> u64 {
            unsafe { MEM_END }
        }
        let mut a = Allocator {
            block_size_bytes: 1,
            segments: Default::default(),
            mem_grow: Some(Box::new(mem_grow)),
            mem_size: Some(Box::new(mem_end)),
            boundary: 16,
        };

        // |oooooooooooooooo|...
        assert_eq!(mem_end(), 16);
        assert_eq!(a.segs(), 0);

        assert_eq!(a.alloc(8).unwrap(), 16);
        // |oooooooooooooooo|xxxxxxxx|...
        assert_eq!(mem_end(), 16 + 8);

        assert_eq!(a.alloc(4).unwrap(), 16 + 8);
        // |oooooooooooooooo|xxxxxxxx|xxxx|...
        assert_eq!(mem_end(), 16 + 8 + 4);

        assert_eq!(a.alloc(4).unwrap(), 16 + 8 + 4);
        // |oooooooooooooooo|xxxxxxxx|xxxx|xxxx| 32
        assert_eq!(mem_end(), 16 + 8 + 4 + 4);
        assert_eq!(a.segs(), 0);

        a.free(16 + 8, 4).unwrap();

        // |oooooooooooooooo|xxxxxxxx|....|xxxx| 32
        assert_eq!(a.segs(), 1);
        assert_eq!(a.seg(16 + 8), 4);

        assert_eq!(a.alloc(4).unwrap(), 16 + 8);
        // |oooooooooooooooo|xxxxxxxx|xxxx|xxxx| 32
        assert_eq!(a.segs(), 0);

        a.free(16, 8).unwrap();
        // |oooooooooooooooo|........|xxxx|xxxx| 32
        assert_eq!(a.segs(), 1);
        assert_eq!(a.seg(16), 8);

        a.free(16 + 8, 4).unwrap();
        // |oooooooooooooooo|............|xxxx|...
        assert_eq!(a.segs(), 1);
        assert_eq!(a.seg(16), 8 + 4);

        assert_eq!(a.alloc(10).unwrap(), 16);
        // |oooooooooooooooo|xxxxxxxxxx|..|xxxx|...
        assert_eq!(a.segs(), 1);
        assert_eq!(a.seg(16 + 10), 2);

        assert_eq!(a.alloc(32).unwrap(), 32);
        // |oooooooooooooooo|xxxxxxxxxx|..|xxxx|xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx|
        assert_eq!(a.segs(), 1);
        assert_eq!(a.seg(16 + 10), 2);

        a.free(32, 32).unwrap();
        // |oooooooooooooooo|xxxxxxxxxx|..|xxxx|...
        assert_eq!(a.segs(), 2);
        assert_eq!(a.seg(16 + 10), 2);
        assert_eq!(a.seg(32), 32);

        assert_eq!(a.alloc(16).unwrap(), 32);
        // |oooooooooooooooo|xxxxxxxxxx|..|xxxx|xxxxxxxxxxxxxxxx|... 64
        assert_eq!(a.segs(), 2);
        assert_eq!(a.seg(16 + 10), 2);
        assert_eq!(a.seg(32 + 16), 16);

        a.free(16 + 10 + 2, 4).unwrap();
        // |oooooooooooooooo|xxxxxxxxxx|......|xxxxxxxxxxxxxxxx|... 64
        assert_eq!(a.segs(), 2);
        assert_eq!(a.seg(16 + 10), 6);
        assert_eq!(a.seg(32 + 16), 16);

        a.free(16, 10).unwrap();
        // |oooooooooooooooo|................|xxxxxxxxxxxxxxxx|... 64
        assert_eq!(a.segs(), 2);
        assert_eq!(a.seg(16), 16);
        assert_eq!(a.seg(32 + 16), 16);

        a.free(32, 16).unwrap();
        // |oooooooooooooooo|... 64
        assert_eq!(a.segs(), 1);
        assert_eq!(a.seg(16), 48);

        assert_eq!(a.alloc(8).unwrap(), 16);
        // |oooooooooooooooo|xxxxxxxx|... 64

        assert_eq!(a.alloc(4).unwrap(), 16 + 8);
        // |oooooooooooooooo|xxxxxxxx|xxxx|... 64

        assert_eq!(a.alloc(4).unwrap(), 16 + 8 + 4);
        // |oooooooooooooooo|xxxxxxxx|xxxx|xxxx|... 64
        assert_eq!(a.segs(), 1);
        assert_eq!(a.seg(32), 32);

        assert_eq!(a.alloc(4).unwrap(), 16 + 8 + 4 + 4);
        assert_eq!(a.alloc(4).unwrap(), 16 + 8 + 4 + 4 + 4);
        // |oooooooooooooooo|xxxxxxxx|xxxx|xxxx|xxxx|xxxx|... 64
        assert_eq!(a.segs(), 1);
        assert_eq!(a.seg(40), 24);
        assert_eq!(mem_end(), 64);

        a.free(16, 8).unwrap();
        // |oooooooooooooooo|........|xxxx|xxxx|xxxx|xxxx|... 64
        a.free(16 + 8 + 4, 4).unwrap();
        // |oooooooooooooooo|........|xxxx|....|xxxx|xxxx|... 64
        assert_eq!(a.segs(), 3);
        assert_eq!(a.seg(16), 8);
        assert_eq!(a.seg(16 + 8 + 4), 4);
        assert_eq!(a.seg(40), 24);

        assert_eq!(a.alloc(4).unwrap(), 28);
        // |oooooooooooooooo|........|xxxx|xxxx|xxxx|xxxx|... 64
        assert_eq!(a.segs(), 2);
        assert_eq!(a.seg(16), 8);
        assert_eq!(a.seg(40), 24);

        assert_eq!(a.alloc(20).unwrap(), 40);
        // |oooooooooooooooo|........|xxxx|xxxx|xxxx|xxxx|xxxxxxxxxxxxxxxxxxxx|...
        assert_eq!(a.segs(), 2);
        assert_eq!(a.seg(16), 8);
        assert_eq!(a.seg(60), 4);

        assert_eq!(a.alloc(4).unwrap(), 60);
        assert_eq!(a.alloc(4).unwrap(), 16);
        // |oooooooooooooooo|xxxx|....|xxxx|xxxx|xxxx|xxxx|xxxxxxxxxxxxxxxxxxxx|xxxx|
        assert_eq!(a.segs(), 1);
        assert_eq!(a.seg(20), 4);

        assert_eq!(a.alloc(4).unwrap(), 20);
        // |oooooooooooooooo|xxxx|xxxx|xxxx|xxxx|xxxx|xxxx|xxxxxxxxxxxxxxxxxxxx|xxxx|
        assert_eq!(a.segs(), 0);

        assert_eq!(a.alloc(4).unwrap(), 64);
        // |oooooooooooooooo|xxxx|xxxx|xxxx|xxxx|xxxx|xxxx|xxxxxxxxxxxxxxxxxxxx|xxxx|xxxx
        assert_eq!(a.segs(), 0);

        a.free(64, 4).unwrap();
        // |oooooooooooooooo|xxxx|xxxx|xxxx|xxxx|xxxx|xxxx|xxxxxxxxxxxxxxxxxxxx|xxxx|....
        assert_eq!(a.segs(), 1);
        assert_eq!(a.seg(64), 4);

        a.free(16, 4).unwrap();
        // |oooooooooooooooo|....|xxxx|xxxx|xxxx|xxxx|xxxx|xxxxxxxxxxxxxxxxxxxx|xxxx|....
        assert_eq!(a.segs(), 2);
        assert_eq!(a.seg(16), 4);
        assert_eq!(a.seg(64), 4);

        a.free(20, 4).unwrap();
        // |oooooooooooooooo|........|xxxx|xxxx|xxxx|xxxx|xxxxxxxxxxxxxxxxxxxx|xxxx|....
        assert_eq!(a.segs(), 2);
        assert_eq!(a.seg(16), 8);
        assert_eq!(a.seg(64), 4);

        a.free(16 + 8 + 4, 4).unwrap();
        // |oooooooooooooooo|........|xxxx|....|xxxx|xxxx|xxxxxxxxxxxxxxxxxxxx|xxxx|....
        assert_eq!(a.segs(), 3);
        assert_eq!(a.seg(16), 8);
        assert_eq!(a.seg(16 + 8 + 4), 4);
        assert_eq!(a.seg(64), 4);

        a.free(16 + 8, 4).unwrap();
        // |oooooooooooooooo|................|xxxx|xxxx|xxxxxxxxxxxxxxxxxxxx|xxxx|....
        assert_eq!(a.segs(), 2);
        assert_eq!(a.seg(16), 16);
        assert_eq!(a.seg(64), 4);

        a.free(32 + 8, 4).unwrap();
        // |oooooooooooooooo|................|xxxx|xxxx|....|xxxxxxxxxxxxxxx|xxxx|....
        assert_eq!(a.segs(), 3);
        assert_eq!(a.seg(16), 16);
        assert_eq!(a.seg(32 + 8), 4);
        assert_eq!(a.seg(64), 4);

        a.free(32 + 4, 4).unwrap();
        // |oooooooooooooooo|................|xxxx|........|xxxxxxxxxxxxxxx|xxxx|....
        assert_eq!(a.segs(), 3);
        assert_eq!(a.seg(16), 16);
        assert_eq!(a.seg(32 + 4), 8);
        assert_eq!(a.seg(64), 4);

        assert!(a.boundary <= mem_end());
    }
}
