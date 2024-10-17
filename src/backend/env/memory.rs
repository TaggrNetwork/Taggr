use ic_cdk::api::stable::{stable_grow, stable_read, stable_size, stable_write};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{cell::RefCell, collections::BTreeMap, fmt::Display, rc::Rc};

use super::{
    features::Feature,
    post::{Post, PostId},
    token::Transaction,
};

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

#[derive(Default, Serialize, Deserialize)]
pub struct Memory {
    pub api: Api,
    pub posts: ObjectManager<PostId, Post>,
    pub features: ObjectManager<PostId, Feature>,
    #[serde(default)]
    pub ledger: ObjectManager<u32, Transaction>,
    #[serde(skip)]
    api_ref: Rc<RefCell<Api>>,
}

// We leave the first 16 bytes recerved for the heap coordinates (offset + length)
const INITIAL_OFFSET: u64 = 16;

impl Api {
    pub fn fix(&mut self) {
        self.allocator.segments.clear();
        self.allocator.boundary = (self.allocator.mem_size.as_ref().unwrap())();
    }

    fn init(&mut self) {
        self.allocator.init();
        if self.write_bytes.is_none() {
            self.write_bytes = Some(Box::new(stable_write));
        }
        if self.read_bytes.is_none() {
            self.read_bytes = Some(Box::new(stable_read));
        }
    }

    pub fn write<T: Serialize>(&mut self, value: &T) -> Result<(u64, u64), String> {
        let buffer: Vec<u8> = serde_cbor::to_vec(value).expect("couldn't serialize");
        let offset = self.allocator.alloc(buffer.len() as u64)?;
        (self.write_bytes.as_ref().expect("no writer"))(offset, &buffer);
        Ok((offset, buffer.len() as u64))
    }

    pub fn remove(&mut self, offset: u64, len: u64) -> Result<(), String> {
        self.allocator.free(offset, len)
    }

    pub fn read_safe<T: DeserializeOwned>(&self, offset: u64, len: u64) -> Result<T, &str> {
        let mut bytes = Vec::with_capacity(len as usize);
        bytes.spare_capacity_mut();
        unsafe {
            bytes.set_len(len as usize);
        }
        (self.read_bytes.as_ref().expect("no reader"))(offset, &mut bytes);
        serde_cbor::from_slice(&bytes).map_err(|_| "serialization error")
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
    pub fn health(&self, unit: &str) -> String {
        self.api_ref.as_ref().borrow().allocator.health(unit)
    }

    pub fn persist_allocator(&mut self) {
        self.api = self.api_ref.as_ref().take();
    }

    /// Initializes the memory allocator.
    pub fn init(&mut self) {
        self.api.init();
        self.api_ref = Rc::new(RefCell::new(std::mem::take(&mut self.api)));
        self.posts.init(Rc::clone(&self.api_ref));
        self.features.init(Rc::clone(&self.api_ref));
        self.ledger.init(Rc::clone(&self.api_ref));
    }

    #[cfg(test)]
    pub fn init_test_api(&mut self) {
        // Skip if memory is initialized
        if self.posts.initialized {
            return;
        }

        static mut MEM_END: u64 = 16;
        static mut MEMORY: Option<Vec<u8>> = None;
        unsafe {
            let size = 1024 * 512;
            MEMORY = Some(Vec::with_capacity(size));
            for _ in 0..size {
                MEMORY.as_mut().unwrap().push(0);
            }
        };
        let mem_grow = |n| unsafe {
            MEM_END += n;
            Ok(0)
        };
        fn mem_end() -> u64 {
            unsafe { MEM_END }
        }
        let writer = |offset, buf: &[u8]| {
            buf.iter().enumerate().for_each(|(i, byte)| unsafe {
                MEMORY.as_mut().unwrap()[offset as usize + i] = *byte
            });
        };
        let reader = |offset, buf: &mut [u8]| {
            for (i, b) in buf.iter_mut().enumerate() {
                *b = unsafe { MEMORY.as_ref().unwrap()[offset as usize + i] }
            }
        };
        let allocator = Allocator {
            block_size_bytes: 1,
            segments: Default::default(),
            mem_grow: Some(Box::new(mem_grow)),
            mem_size: Some(Box::new(mem_end)),
            boundary: 16,
        };
        self.api = Api {
            allocator,
            write_bytes: Some(Box::new(writer)),
            read_bytes: Some(Box::new(reader)),
        };
        self.init();
    }
}

pub fn heap_to_stable(state: &mut super::State) {
    state.memory.persist_allocator();
    let offset = state.memory.api.boundary();
    let bytes = serde_cbor::to_vec(&state).expect("couldn't serialize the state");
    let len = bytes.len() as u64;
    if offset + len > (stable_size() << 16) {
        stable_grow((len >> 16) + 1).expect("couldn't grow memory");
    }
    stable_write(offset, &bytes);
    stable_write(0, &offset.to_be_bytes());
    stable_write(8, &len.to_be_bytes());
}

pub fn heap_address() -> (u64, u64) {
    let mut offset_bytes: [u8; 8] = Default::default();
    stable_read(0, &mut offset_bytes);
    let offset = u64::from_be_bytes(offset_bytes);
    let mut len_bytes: [u8; 8] = Default::default();
    stable_read(8, &mut len_bytes);
    let len = u64::from_be_bytes(len_bytes);
    (offset, len)
}

pub fn stable_to_heap() -> super::State {
    let (offset, len) = heap_address();
    ic_cdk::println!("Reading heap from coordinates: {:?}", (offset, len));
    let api = Api::default();
    let mut state: super::State = api.read(offset, len);
    state.memory.init();
    state
}

#[derive(Serialize, Deserialize)]
struct Allocator {
    // The smallest amount of space that can be allocated.
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

impl Default for Api {
    fn default() -> Self {
        let mut instance = Self {
            allocator: Default::default(),
            write_bytes: None,
            read_bytes: None,
        };
        instance.init();
        instance
    }
}

impl Default for Allocator {
    fn default() -> Self {
        let mut instance = Self {
            block_size_bytes: 300,
            boundary: INITIAL_OFFSET,
            segments: Default::default(),
            mem_size: None,
            mem_grow: None,
        };
        instance.init();
        instance
    }
}

impl Allocator {
    fn init(&mut self) {
        if self.mem_size.is_none() {
            self.mem_size = Some(Box::new(|| stable_size() << 16));
        }
        if self.mem_grow.is_none() {
            self.mem_grow = Some(Box::new(|n| {
                stable_grow((n >> 16) + 1).map_err(|err| format!("couldn't grow memory: {:?}", err))
            }));
        }
    }

    fn get_allocation_length(&self, n: u64) -> u64 {
        let block_size = self.block_size_bytes.max(1);
        (n + block_size - 1) / block_size * block_size
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

#[derive(Serialize, Deserialize)]
pub struct ObjectManager<K: Ord + Eq, T: Serialize + DeserializeOwned> {
    index: BTreeMap<K, (u64, u64)>,
    #[serde(skip)]
    initialized: bool,
    #[serde(skip)]
    api: Rc<RefCell<Api>>,
    #[serde(skip)]
    phantom: std::marker::PhantomData<T>,
}

impl<K: Ord + Eq, T: Serialize + DeserializeOwned> Default for ObjectManager<K, T> {
    fn default() -> Self {
        Self {
            phantom: Default::default(),
            index: Default::default(),
            api: Default::default(),
            initialized: false,
        }
    }
}

impl<K: Eq + Ord + Clone + Display, T: Serialize + DeserializeOwned> ObjectManager<K, T> {
    pub fn len(&self) -> usize {
        self.index.len()
    }

    pub fn insert(&mut self, id: K, value: T) -> Result<(), String> {
        assert!(self.initialized, "allocator uninitialized");
        if self.index.contains_key(&id) {
            self.remove(&id)?;
        }
        self.index.insert(id, self.api.borrow_mut().write(&value)?);
        Ok(())
    }

    pub fn get_safe(&self, id: &K) -> Option<T> {
        self.index.get(id).and_then(|(offset, len)| {
            self.api
                .borrow()
                .read_safe(*offset, *len)
                .map_err(|err| {
                    ic_cdk::println!("key {} can't be deserialized", id);
                    err
                })
                .ok()
        })
    }

    pub fn get(&self, id: &K) -> Option<T> {
        self.index
            .get(id)
            .map(|(offset, len)| self.api.borrow().read(*offset, *len))
    }

    pub fn iter(&self) -> Box<dyn DoubleEndedIterator<Item = (&'_ K, T)> + '_> {
        Box::new(
            self.index
                .keys()
                .collect::<Vec<_>>()
                .into_iter()
                .map(move |id| (id, self.get(id).expect("couldn't retrieve value"))),
        )
    }

    pub fn remove_index(&mut self, id: &K) -> Result<(), String> {
        assert!(self.initialized, "allocator uninitialized");
        self.index.remove(id).ok_or("not found")?;
        Ok(())
    }

    pub fn remove(&mut self, id: &K) -> Result<T, String> {
        assert!(self.initialized, "allocator uninitialized");
        let (offset, len) = self.index.remove(id).ok_or("not found")?;
        let value = self.api.borrow().read(offset, len);
        self.api.borrow_mut().remove(offset, len)?;
        Ok(value)
    }

    pub fn init(&mut self, api: Rc<RefCell<Api>>) {
        self.initialized = true;
        self.api = api;
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn test_allocation_size() {
        let a = Allocator::default();
        assert_eq!(a.block_size_bytes, 300);
        assert_eq!(a.get_allocation_length(0), 0);
        assert_eq!(a.get_allocation_length(1), 300);
        assert_eq!(a.get_allocation_length(100), 300);
        assert_eq!(a.get_allocation_length(199), 300);
        assert_eq!(a.get_allocation_length(299), 300);
        assert_eq!(a.get_allocation_length(300), 300);
        assert_eq!(a.get_allocation_length(301), 600);
        assert_eq!(a.get_allocation_length(400), 600);
        assert_eq!(a.get_allocation_length(599), 600);
    }

    #[test]
    fn test_leaks() {
        let mut memory = Memory::default();
        memory.init_test_api();

        memory.posts.insert(0, Post::default()).unwrap();
        memory.posts.insert(1, Post::default()).unwrap();
        memory.posts.insert(2, Post::default()).unwrap();

        // overwrite post 1 with a much larger value so that it does not fit into the free slot
        let mut post = Post::default();
        post.body =
            "overwrite post 1 with a much larger value so that it does not fit into the free slot"
                .into();
        memory.posts.insert(1, post).unwrap();

        // ensure that the memory from the previous vlaue was deallocated
        assert_eq!(memory.api_ref.as_ref().borrow().allocator.segments.len(), 1);
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
