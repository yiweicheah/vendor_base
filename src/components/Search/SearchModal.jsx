import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Modal, Stack, TextInput,
  Center, Text, Button, SimpleGrid, Box, Skeleton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { searchCards, getCardDetail, getCardImage, extractPrice } from '../../lib/pokewallet';
import { tokenize, buildQuery, isQueryTooShort, buildAlternateNumberQuery, normalizeStr } from '../../lib/tokenizer';
import useCartStore from '../../store/cartStore';
import CardGrid from './CardGrid';

function LoadingSkeleton() {
  return (
    <SimpleGrid cols={2} spacing={8} verticalSpacing={12}>
      {Array.from({ length: 6 }).map((_, i) => (
        <Box key={i}>
          <Skeleton style={{ aspectRatio: '245/337' }} radius="xs" />
          <Skeleton height={13} mt={6} radius="xs" width="75%" />
          <Skeleton height={11} mt={4} radius="xs" width="45%" />
        </Box>
      ))}
    </SimpleGrid>
  );
}

function scoreByName(card, nameTokens) {
  if (!nameTokens.length) return 0;
  const name = normalizeStr((card.card_info?.name ?? '').toLowerCase());
  const normTokens = nameTokens.map((t) => normalizeStr(t.toLowerCase()));
  const joined = normTokens.join(' ');
  if (name === joined) return 100;
  if (name.startsWith(joined)) return 80;
  const matchCount = normTokens.filter((t) => name.includes(t)).length;
  if (matchCount === normTokens.length) return name.startsWith(normTokens[0]) ? 70 : 60;
  return matchCount * 10;
}

function filterBySetTotal(results, setTotal) {
  if (setTotal == null) return results;
  return results.filter((card) => {
    const num = card.card_info?.card_number ?? '';
    const match = num.match(/^(\d+)\/(\d+)$/);
    if (match) return parseInt(match[2], 10) === setTotal;
    return true;
  });
}

export default function SearchModal({ opened, onClose, side }) {
  const isMobile = useMediaQuery('(max-width: 48em)');
  const { addLine } = useCartStore();

  const [query,       setQuery]       = useState('');
  const [results,     setResults]     = useState([]);
  const [page,        setPage]        = useState(1);
  const [hasMore,     setHasMore]     = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,       setError]       = useState(null);
  const [lastQuery,   setLastQuery]   = useState('');

  const abortRef = useRef(null);

  // ─── Reset on close ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!opened) {
      abortRef.current?.abort();
      setQuery('');
      setResults([]);
      setPage(1);
      setHasMore(false);
      setLoading(false);
      setLoadingMore(false);
      setError(null);
    }
  }, [opened]);

  // ─── Fetch first page ─────────────────────────────────────────────────────
  const fetchPage1 = useCallback(async (rawQuery) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const { nameTokens, localId, setTotal, setTotalRaw } = tokenize(rawQuery);
    const q = buildQuery({ nameTokens, localId, setTotalRaw });

    setLastQuery(rawQuery);
    setLoading(true);
    setError(null);
    setResults([]);
    setPage(1);
    setHasMore(false);

    try {
      const altQ = nameTokens.length === 0
        ? buildAlternateNumberQuery({ localId, setTotalRaw })
        : null;

      let rawResults;
      let primaryPagination;

      if (altQ) {
        const [primary, alternate] = await Promise.all([
          searchCards({ query: q,    page: 1, signal: controller.signal }),
          searchCards({ query: altQ, page: 1, signal: controller.signal }),
        ]);
        if (abortRef.current !== controller) return;
        const seen = new Set();
        rawResults = [...(primary.results ?? []), ...(alternate.results ?? [])].filter((c) => {
          if (seen.has(c.id)) return false;
          seen.add(c.id);
          return true;
        });
        primaryPagination = primary.pagination;
      } else {
        const data = await searchCards({ query: q, page: 1, signal: controller.signal });
        if (abortRef.current !== controller) return;
        rawResults = data.results ?? [];
        primaryPagination = data.pagination;
      }

      const filtered = filterBySetTotal(rawResults, setTotal);
      const sorted = nameTokens.length
        ? [...filtered].sort((a, b) => scoreByName(b, nameTokens) - scoreByName(a, nameTokens))
        : filtered;
      setResults(sorted);
      setPage(1);
      setHasMore((primaryPagination?.page ?? 1) < (primaryPagination?.total_pages ?? 1));
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.code === 'RATE_LIMIT' ? 'rate_limit' : 'network');
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Submit handler ───────────────────────────────────────────────────────
  function handleSubmit(e) {
    e.preventDefault();
    if (isQueryTooShort(query)) return;
    fetchPage1(query);
  }

  // ─── Load next page ───────────────────────────────────────────────────────
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;

    const { nameTokens, localId, setTotal, setTotalRaw } = tokenize(query);
    const q = buildQuery({ nameTokens, localId, setTotalRaw });
    const nextPage = page + 1;

    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingMore(true);

    try {
      const data = await searchCards({ query: q, page: nextPage, signal: controller.signal });
      if (abortRef.current !== controller) return;
      if (lastQuery !== query) return;

      const filtered = filterBySetTotal(data.results ?? [], setTotal);
      const sorted = nameTokens.length
        ? [...filtered].sort((a, b) => scoreByName(b, nameTokens) - scoreByName(a, nameTokens))
        : filtered;
      setResults((prev) => [...prev, ...sorted]);
      setPage(nextPage);
      setHasMore(nextPage < (data.pagination?.total_pages ?? nextPage));
    } catch (err) {
      if (err.name === 'AbortError') return;
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, query, page, lastQuery]);

  // ─── Card select ──────────────────────────────────────────────────────────
  const handleSelect = useCallback(async (card) => {
    const detail = await getCardDetail(card.id);
    const resolved = detail ?? card;

    const priceInfo = extractPrice(resolved);
    const { url: imageUrl } = await getCardImage(resolved);

    addLine(side, {
      type:           'card',
      qty:            1,
      unitPrice:      priceInfo?.myr ?? 0,
      cardExternalId: resolved.id,
      cardName:       resolved.card_info?.name ?? '',
      cardNumber:     resolved.card_info?.card_number ?? '',
      setName:        resolved.card_info?.set_name ?? '',
      imageUrl:       imageUrl ?? null,
      marketPrice:    priceInfo?.myr ?? null,
      priceSource:    priceInfo?.source ?? null,
    });

    onClose();
  }, [side, addLine, onClose]);

  // ─── Render ───────────────────────────────────────────────────────────────
  // idle = nothing searched yet; noResults = searched and got nothing back
  const idle      = !loading && results.length === 0 && !error && lastQuery === '';
  const noResults = !loading && results.length === 0 && !error && lastQuery !== '' && lastQuery === query;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Add card"
      fullScreen={isMobile}
      size="lg"
      padding="md"
      styles={{ body: { paddingTop: 8 } }}
    >
      <Stack gap="sm">
        <form onSubmit={handleSubmit}>
          <TextInput
            placeholder="Name, number, or both  (e.g. charizard 011/080)"
            leftSection={<IconSearch size={15} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            autoFocus
          />
        </form>

        {idle && (
          <Center py="xl">
            <Text c="dimmed" size="sm">Type a card name or number to search</Text>
          </Center>
        )}

        {loading && <LoadingSkeleton />}

        {!loading && results.length > 0 && (
          <CardGrid
            results={results}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={handleLoadMore}
            onSelect={handleSelect}
          />
        )}

        {noResults && (
          <Center py="xl">
            <Text c="dimmed" size="sm">No cards found for "{query}"</Text>
          </Center>
        )}

        {error === 'rate_limit' && (
          <Center py="xl">
            <Text c="red" size="sm">Rate limit reached. Try again in a few minutes.</Text>
          </Center>
        )}

        {error === 'network' && (
          <Stack align="center" gap="xs" py="xl">
            <Text c="red" size="sm">Couldn't reach the API. Check your connection.</Text>
            <Button variant="subtle" size="xs" onClick={() => fetchPage1(lastQuery)}>
              Retry
            </Button>
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}
