import { useEffect, useRef } from 'react';
import { Box, Text } from '@mantine/core';
import CardTile from './CardTile';

function SkeletonTile() {
  return (
    <Box>
      <Box
        style={{
          aspectRatio:  '245 / 337',
          background:   'var(--mantine-color-dark-6)',
          borderRadius: 4,
        }}
      />
      <Box p={6} style={{ minHeight: 44 }} />
    </Box>
  );
}

export default function CardGrid({
  results,
  hasMore,
  loadingMore,
  onLoadMore,
  onSelect,
}) {
  const sentinelRef = useRef(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  return (
    <Box>
      <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', columnGap: 8, rowGap: 12 }}>
        {results.map((card) => (
          <CardTile key={card.id} card={card} onSelect={onSelect} />
        ))}
        {loadingMore && (
          <>
            <SkeletonTile />
            <SkeletonTile />
          </>
        )}
      </Box>

      {/* Sentinel div — triggers next page load */}
      {hasMore && (
        <div ref={sentinelRef} style={{ height: 1, marginTop: 8 }} />
      )}

      {!hasMore && results.length > 0 && (
        <Text size="xs" c="dimmed" ta="center" mt="md" mb="sm">
          No more results
        </Text>
      )}
    </Box>
  );
}
