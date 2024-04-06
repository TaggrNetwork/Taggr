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
        // We can only compare empty iterators
        self.peek().is_none() && other.peek().is_none()
    }
}

impl<'a, T: Eq> Eq for DelayedIterator<'a, T> {}

impl<'a, T: Ord> Ord for DelayedIterator<'a, T> {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self.peek(), &other.peek()) {
            // We can't compare iterators by the head value only
            (Some(a), Some(b)) if &a == b => Ordering::Less,
            (a, b) => a.cmp(b),
        }
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
        // Remove all equal elements from all iterators
        while let Some(next) = self.values.pop_last() {
            // If the next value is smaller, there is nothing to do.
            if next.peek() < value {
                self.values.insert(next);
                break;
            }
            // If the next value is not larger, then we either have duplicates, or non sorted iterators, we
            // have to skip these values.
            else {
                if let Some(more) = next.advance() {
                    self.values.insert(more);
                }
            }
        }
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merged_iterators() {
        let v1 = vec![9, 7, 4];
        let v2 = vec![11, 10, 5];
        let v3 = vec![8, 7, 6, 0];
        let v4 = vec![11, 3, 3, 3, 2, 1];
        let iterator = IteratorMerger::new(vec![
            Box::new(v1.iter()),
            Box::new(v2.iter()),
            Box::new(v3.iter()),
            Box::new(v4.iter()),
        ]);

        assert_eq!(
            iterator.collect::<Vec<_>>(),
            vec![&11, &10, &9, &8, &7, &6, &5, &4, &3, &2, &1, &0]
        );
    }
}
