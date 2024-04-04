use std::cmp::Ordering;
use std::collections::BTreeSet;

/// Wraps a post iterator and implements `Ord` around the peeked element.
struct DelayedIterator<'a, T> {
    head: Option<&'a T>,
    iterator: Box<dyn Iterator<Item = &'a T> + 'a>,
}

impl<'a, T> DelayedIterator<'a, T> {
    fn new(mut iterator: Box<dyn Iterator<Item = &'a T> + 'a>) -> Self {
        Self {
            head: iterator.next(),
            iterator,
        }
    }

    fn peek(&self) -> Option<&'a T> {
        self.head
    }

    fn advance(mut self) -> Option<Self> {
        self.head = self.iterator.next();
        self.head?;
        Some(self)
    }
}

impl<'a, T: Eq> PartialEq for DelayedIterator<'a, T> {
    fn eq(&self, other: &Self) -> bool {
        self.peek() == other.peek()
    }
}

impl<'a, T: Eq> Eq for DelayedIterator<'a, T> {}

impl<'a, T: Ord> Ord for DelayedIterator<'a, T> {
    fn cmp(&self, other: &Self) -> Ordering {
        self.peek().cmp(&other.peek())
    }
}

impl<'a, T: Ord> PartialOrd for DelayedIterator<'a, T> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.peek().cmp(&other.peek()))
    }
}

/// Merges all given iterators by ordering of their consumption according to the ordering of their
/// elements. It is currently used to merge many post iterators and to return the newest posts no
/// matter from which iterator they are served.
pub struct IteratorMerger<'a, T> {
    values: BTreeSet<DelayedIterator<'a, T>>,
}

impl<'a, T: Ord + Eq> IteratorMerger<'a, T> {
    pub fn new(iterators: Vec<Box<dyn Iterator<Item = &'a T> + 'a>>) -> Self {
        IteratorMerger {
            values: iterators
                .into_iter()
                .map(|iterator| DelayedIterator::new(iterator))
                .collect(),
        }
    }
}

impl<'a, T: Clone + Ord> Iterator for IteratorMerger<'a, T> {
    type Item = &'a T;

    // Returns the largest value from all iterators
    fn next(&mut self) -> Option<Self::Item> {
        if self.values.is_empty() {
            return None;
        }
        let next = self.values.pop_last()?;
        let value = next.peek();
        if let Some(more) = next.advance() {
            self.values.insert(more);
        }
        value
    }
}
