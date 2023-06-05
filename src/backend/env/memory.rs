use ic_cdk::api::stable::{stable64_grow, stable64_read, stable64_size, stable64_write};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{cell::RefCell, collections::BTreeMap, fmt::Display, rc::Rc};

use super::post::PostId;

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Api {
    allocator: Allocator,
}

#[derive(Default, Serialize, Deserialize)]
pub struct Memory {
    api: Api,
    #[serde(skip)]
    pub posts: ObjectManager<PostId>,
    #[serde(skip)]
    api_ref: Rc<RefCell<Api>>,
}

// We leave the first 16 bytes recerved for the heap coordinates (offset + length)
const INITIAL_OFFSET: u64 = 16;

impl Api {
    pub fn write<T: Serialize>(&mut self, value: &T) -> Result<(u64, u64), String> {
        let buffer: Vec<u8> = serde_cbor::to_vec(value).expect("couldn't serialize");
        let offset = self.allocator.alloc(buffer.len() as u64)?;
        stable64_write(offset, &buffer);
        Ok((offset, buffer.len() as u64))
    }

    #[allow(dead_code)]
    pub fn remove(&mut self, offset: u64, len: u64) -> Result<(), String> {
        self.allocator.free(offset, len)
    }

    pub fn read<T: DeserializeOwned>(offset: u64, len: u64) -> T {
        let mut bytes = Vec::with_capacity(len as usize);
        bytes.spare_capacity_mut();
        unsafe {
            bytes.set_len(len as usize);
        }
        stable64_read(offset, &mut bytes);
        serde_cbor::from_slice(&bytes).expect("couldn't deserialize")
    }
}

impl Memory {
    pub fn report_health(&self) -> String {
        self.api_ref.as_ref().borrow().allocator.health()
    }
}

pub fn heap_to_stable(state: &mut super::State) {
    let mut api = state.memory.api.clone();
    let (offset, len) = match api.write(state) {
        Ok(values) => values,
        // Plan B: if the allocator ever fails, just dump the heap at the end of stable memory
        Err(err) => {
            state.logger.log(
                format!("Allocator failed when dumping the heap: {:?}", err),
                "CRITICAL".into(),
            );
            let bytes = serde_cbor::to_vec(&state).expect("couldn't serialize the state");
            let offset = stable64_size() >> 16;
            stable64_grow(1 + (bytes.len() as u64 >> 16)).expect("couldn't grow memory");
            stable64_write(offset, &bytes);
            (offset, bytes.len() as u64)
        }
    };
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
    ic_cdk::println!("Reading heap from coordinates: {:?}", (offset, len),);
    Api::read(offset, len)
}

#[derive(Serialize, Deserialize)]
struct Allocator {
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
    fn alloc(&mut self, n: u64) -> Result<u64, String> {
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
        ic_cdk::println!("Allocated {} bytes, {}", n, self.health());
        Ok(start)
    }

    fn free(&mut self, offset: u64, size: u64) -> Result<(), String> {
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
        ic_cdk::println!(
            "Deallocated segment={:?}, {}",
            (offset, size),
            self.health()
        );
        Ok(())
    }

    fn health(&self) -> String {
        let megabyte = 1024 * 1024;
        format!(
            "boundary=`{}Mb`, mem_size=`{}Mb`, segments=`{:?}`",
            self.boundary / megabyte,
            self.mem_size.as_ref().map(|f| f()).unwrap_or_default() / megabyte,
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
    #[allow(dead_code)]
    api: Rc<RefCell<Api>>,
}

impl<K: Eq + Ord + Clone + Display> ObjectManager<K> {
    #[allow(dead_code)]
    pub fn insert<T: Serialize>(&mut self, id: K, value: T) -> Result<(), String> {
        self.index.insert(id, self.api.borrow_mut().write(&value)?);
        Ok(())
    }

    #[allow(dead_code)]
    pub fn get<T: DeserializeOwned>(&self, id: &K) -> Option<T> {
        self.index
            .get(id)
            .map(|(offset, len)| Api::read(*offset, *len))
    }

    #[allow(dead_code)]
    pub fn remove<T: DeserializeOwned>(&mut self, id: &K) -> Result<T, String> {
        let (offset, len) = self.index.remove(id).ok_or("not found")?;
        let value = Api::read(offset, len);
        self.api.borrow_mut().remove(offset, len)?;
        Ok(value)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

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
