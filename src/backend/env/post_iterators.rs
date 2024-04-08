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

pub enum MergeStrategy {
    // Returns all values that appear in at least one iterator exactly once.
    Or,
    // Returns only values appearing in all iterators at least once.
    And,
}

/// Merges all given iterators by ordering of their consumption according to the ordering of their
/// elements. It is currently used to merge many post iterators and to return the newest posts no
/// matter from which iterator they are served.
pub struct IteratorMerger<'a, T> {
    values: BTreeSet<DelayedIterator<'a, T>>,
    strategy: MergeStrategy,
}

impl<'a, T: Ord + Eq> IteratorMerger<'a, T> {
    pub fn new(
        strategy: MergeStrategy,
        iterators: Vec<Box<dyn Iterator<Item = &'a T> + 'a>>,
    ) -> Self {
        IteratorMerger {
            strategy,
            values: iterators
                .into_iter()
                .map(|iterator| DelayedIterator::new(iterator))
                .collect(),
        }
    }
}

impl<'a, T: Clone + Ord> IteratorMerger<'a, T> {
    // Returns the next value appearing in all iterators.
    fn next_and(&mut self) -> Option<&'a T> {
        let candidate = self.values.last()?.peek()?;

        // If the candidate value appears in all iterators, we need advance them to the next value.
        if self
            .values
            .iter()
            .all(|iterator| iterator.peek() == Some(candidate))
        {
            // Advance iterators until they all have smaller values.
            while self.values.last().and_then(|iter| iter.peek()) == Some(candidate) {
                if let Some(iter) = self.values.pop_last() {
                    if let Some(more) = iter.advance() {
                        self.values.insert(more);
                        continue;
                    }
                }
                // If we're here, we exhausted at least one iterator, so we're done.
                self.values.clear();
                break;
            }
            return Some(candidate);
        }

        // If there are values not equal to the largest ones, then we need to remove it and repeat
        // the search.
        let iter = self.values.pop_last()?;
        let more = iter.advance()?;
        self.values.insert(more);

        return self.next_and();
    }

    fn next_or(&mut self) -> Option<&'a T> {
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
            else if let Some(more) = next.advance() {
                self.values.insert(more);
            }
        }
        value
    }
}

impl<'a, T: Clone + Ord> Iterator for IteratorMerger<'a, T> {
    type Item = &'a T;

    // Returns the largest value from all iterators
    fn next(&mut self) -> Option<Self::Item> {
        match self.strategy {
            MergeStrategy::Or => self.next_or(),
            MergeStrategy::And => self.next_and(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merged_or_iterators_1() {
        let v1 = [9, 7, 4];
        let v2 = [11, 10, 5];
        let v3 = [8, 7, 6, 0];
        let v4 = [11, 3, 3, 3, 2, 1];
        let iterator = IteratorMerger::new(
            MergeStrategy::Or,
            vec![
                Box::new(v1.iter()),
                Box::new(v2.iter()),
                Box::new(v3.iter()),
                Box::new(v4.iter()),
            ],
        );

        assert_eq!(
            iterator.collect::<Vec<_>>(),
            vec![&11, &10, &9, &8, &7, &6, &5, &4, &3, &2, &1, &0]
        );
    }

    #[test]
    fn test_merged_or_iterators_2() {
        let v1 = [9, 7, 4];
        let v2 = [11, 10, 5];
        let v3 = [];
        let v4 = [11, 3, 3, 3, 2, 1];
        let iterator = IteratorMerger::new(
            MergeStrategy::Or,
            vec![
                Box::new(v1.iter()),
                Box::new(v2.iter()),
                Box::new(v3.iter()),
                Box::new(v4.iter()),
            ],
        );

        assert_eq!(
            iterator.collect::<Vec<_>>(),
            [&11, &10, &9, &7, &5, &4, &3, &2, &1]
        );
    }

    #[test]
    fn test_merged_and_iterators_1() {
        let v1 = [9, 7, 4];
        let v2 = [11, 10, 9, 5];
        let v3 = [9, 8, 7, 6, 0];
        let v4 = [12, 11, 9, 3, 3, 3, 2, 1];
        let iterator = IteratorMerger::new(
            MergeStrategy::And,
            vec![
                Box::new(v1.iter()),
                Box::new(v2.iter()),
                Box::new(v3.iter()),
                Box::new(v4.iter()),
            ],
        );

        assert_eq!(iterator.collect::<Vec<_>>(), vec![&9]);
    }

    #[test]
    fn test_merged_and_iterators_2() {
        let v1 = [9, 7, 4, 3];
        let v2 = [11, 10, 9, 5, 3];
        let v3 = [9, 8, 7, 6, 3, 0];
        let v4 = [12, 11, 9, 3, 3, 3, 2, 1];
        let iterator = IteratorMerger::new(
            MergeStrategy::And,
            vec![
                Box::new(v1.iter()),
                Box::new(v2.iter()),
                Box::new(v3.iter()),
                Box::new(v4.iter()),
            ],
        );

        assert_eq!(iterator.collect::<Vec<_>>(), vec![&9, &3]);
    }

    #[test]
    fn test_merged_and_iterators_3() {
        let v1 = [4, 3, 2, 1];
        let v2 = [4, 3, 2, 1];
        let v3 = [4, 3, 2, 1];
        let v4 = [4, 3, 2, 1];
        let iterator = IteratorMerger::new(
            MergeStrategy::And,
            vec![
                Box::new(v1.iter()),
                Box::new(v2.iter()),
                Box::new(v3.iter()),
                Box::new(v4.iter()),
            ],
        );

        assert_eq!(iterator.collect::<Vec<_>>(), vec![&4, &3, &2, &1]);
    }
}
