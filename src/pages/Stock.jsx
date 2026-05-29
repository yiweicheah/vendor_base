import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import {
  Box,
  ScrollArea,
  Stack,
  Group,
  Text,
  Badge,
  TextInput,
  Select,
  Image,
  Center,
  ThemeIcon,
  Button,
  ActionIcon,
  Pagination,
  Tabs,
  Paper,
  Tooltip,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import {
  IconSearch,
  IconPackage,
  IconUpload,
  IconDownload,
  IconLayoutList,
  IconLayoutGrid,
  IconRefresh,
  IconPlus,
  IconPencil,
  IconCheck,
  IconX,
  IconTrash,
} from "@tabler/icons-react";
import { buildStockMapFromRows } from "../lib/analytics";
import { normalizeStr } from "../lib/tokenizer";
import { refreshStaleCardPrices } from "../lib/priceRefresh";
import useOrgStore from "../store/orgStore";
import useAuthStore from "../store/authStore";
import { createSealedProduct, updateSealedProduct as updateSealedProductDb, deleteSealedProduct as deleteSealedProductDb, loadStock } from "../lib/db";
import ImportModal from "../components/Stock/ImportModal";
import AddStockModal from "../components/Stock/AddStockModal";
import CardDetailModal from "../components/Cards/CardDetailModal";
import CurrencyInput from "../components/shared/CurrencyInput";
import { rm } from "../lib/format";

// ─── Shared helpers ───────────────────────────────────────────────────────────

function GainText({ value, costBasis }) {
  if (!value) return null;
  const color = value > 0 ? "green.4" : value < 0 ? "red.4" : "dimmed";
  const prefix = value > 0 ? "+" : "";
  const pct =
    costBasis > 0
      ? ` (${prefix}${((value / costBasis) * 100).toFixed(1)}%)`
      : "";
  return (
    <Text size="xs" c={color}>
      {prefix}{rm(value)}
      {pct}
    </Text>
  );
}

function StockRow({ item }) {
  const isCard = item.type === "card";

  return (
    <Group justify="space-between" wrap="nowrap" gap="sm">
      <Box style={{ flexShrink: 0 }}>
        {isCard && item.imageUrl ? (
          <Image src={item.imageUrl} w={28} h={39} radius="sm" fit="contain" />
        ) : (
          <Box
            w={28}
            h={39}
            bg="dark.6"
            style={{
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {!isCard && (
              <IconPackage size={14} color="var(--mantine-color-dark-2)" />
            )}
          </Box>
        )}
      </Box>

      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Group gap="xs" wrap="nowrap">
          <Text size="sm" fw={500} truncate>
            {item.name}
          </Text>
        </Group>
        {isCard && (
          <Text size="xs" c="dimmed" truncate>
            {[item.setName, item.number, item.lang].filter(Boolean).join(" · ")}
          </Text>
        )}
        <Text size="xs" c="dimmed">
          Avg cost {rm(item.avgCost)}
        </Text>
      </Stack>

      <Stack gap={2} align="flex-end" style={{ flexShrink: 0 }}>
        <Badge color="violet" variant="light" size="sm">
          ×{item.qty}
        </Badge>
        {isCard && item.marketValue > 0 && (
          <Text size="xs" c="dimmed">
            {rm(item.marketValue)}
          </Text>
        )}
        {isCard && (
          <GainText value={item.unrealizedGain} costBasis={item.costBasis} />
        )}
      </Stack>
    </Group>
  );
}

function StockGridItem({ item, onCardClick }) {
  const isCard = item.type === "card";
  return (
    <Stack gap={6}>
      <Box
        style={{
          width: "100%",
          position: "relative",
          cursor: isCard ? "pointer" : "default",
        }}
        onClick={
          isCard ? () => onCardClick(item.key, item.imageUrl) : undefined
        }
      >
        {isCard && item.imageUrl ? (
          <Image
            src={item.imageUrl}
            fit="contain"
            style={{
              aspectRatio: "245/337",
              width: "100%",
              borderRadius: "4.4%",
              overflow: "hidden",
            }}
          />
        ) : (
          <Box
            bg="dark.6"
            style={{
              aspectRatio: "245/337",
              borderRadius: "4.4%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconPackage size={24} color="var(--mantine-color-dark-2)" />
          </Box>
        )}
        <Badge
          style={{ position: "absolute", top: 4, right: 4 }}
          color="violet"
          variant="filled"
          size="xs"
        >
          ×{item.qty}
        </Badge>
      </Box>
      <Stack gap={2}>
        <Text size="xs" fw={500} lineClamp={2}>
          {item.name}
        </Text>
        <Text size="xs" c="dimmed">
          Cost {rm(item.avgCost)}
        </Text>
        {isCard && item.avgMarket > 0 && (
          <Text size="xs" c="dimmed">
            Mkt {rm(item.avgMarket)}
          </Text>
        )}
        {isCard && (
          <GainText value={item.unrealizedGain} costBasis={item.costBasis} />
        )}
      </Stack>
    </Stack>
  );
}

// ─── Sealed catalog tab ───────────────────────────────────────────────────────

const SEALED_PAGE_SIZE = 20;

const SEALED_SORT_OPTIONS = [
  { value: "name-asc", label: "Name (A–Z)" },
  { value: "name-desc", label: "Name (Z–A)" },
  { value: "qty-desc", label: "Qty (high first)" },
  { value: "cost-desc", label: "Avg cost (high first)" },
];

const SEALED_STOCK_FILTER_OPTIONS = [
  { value: "all", label: "All products" },
  { value: "in", label: "In stock" },
  { value: "out", label: "Out of stock" },
];

function SealedCatalog({
  sealedProducts,
  addSealedProduct,
  updateSealedProduct,
  removeSealedProduct,
  sealedStockMap,
  orgId,
  userId,
}) {
  const [name, setName] = useState("");
  const [rrp, setRrp] = useState(0);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name-asc");
  const [stockFilter, setStockFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [editingRrp, setEditingRrp] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed || !orgId) return;
    setSaving(true);
    try {
      const created = await createSealedProduct({
        orgId,
        name: trimmed,
        recommendedRetailPriceMyr: rrp || null,
        createdById: userId,
      });
      addSealedProduct(created);
      setName("");
      setRrp(0);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(p) {
    setEditingId(p.id);
    setEditingName(p.name);
    setEditingRrp(p.recommendedRetailPriceMyr ?? 0);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingName("");
    setEditingRrp(0);
  }

  async function handleSave(id) {
    const trimmed = editingName.trim();
    if (!trimmed) return;
    setRenaming(true);
    try {
      const updated = await updateSealedProductDb({
        id,
        name: trimmed,
        recommendedRetailPriceMyr: editingRrp || null,
      });
      updateSealedProduct(updated);
      cancelEdit();
    } finally {
      setRenaming(false);
    }
  }

  async function confirmDelete(id) {
    setDeleting(true);
    try {
      await deleteSealedProductDb(id);
      removeSealedProduct(id);
      setPendingDeleteId(null);
    } finally {
      setDeleting(false);
    }
  }

  const filtered = useMemo(() => {
    const q = normalizeStr(query.trim().toLowerCase());
    let list = sealedProducts;

    if (q) {
      list = list.filter((p) => normalizeStr(p.name.toLowerCase()).includes(q));
    }

    if (stockFilter === "in") {
      list = list.filter(
        (p) => (sealedStockMap.get(p.name.toLowerCase())?.qty ?? 0) > 0,
      );
    } else if (stockFilter === "out") {
      list = list.filter(
        (p) => (sealedStockMap.get(p.name.toLowerCase())?.qty ?? 0) === 0,
      );
    }

    const sorted = [...list];
    switch (sort) {
      case "name-desc":
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "qty-desc":
        sorted.sort((a, b) => {
          const aq = sealedStockMap.get(a.name.toLowerCase())?.qty ?? 0;
          const bq = sealedStockMap.get(b.name.toLowerCase())?.qty ?? 0;
          return bq - aq;
        });
        break;
      case "cost-desc":
        sorted.sort((a, b) => {
          const ac = sealedStockMap.get(a.name.toLowerCase())?.avgCost ?? 0;
          const bc = sealedStockMap.get(b.name.toLowerCase())?.avgCost ?? 0;
          return bc - ac;
        });
        break;
      default:
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }
    return sorted;
  }, [sealedProducts, query, sort, stockFilter, sealedStockMap]);

  useEffect(() => {
    setPage(1);
  }, [filtered]);

  const totalPages = Math.ceil(filtered.length / SEALED_PAGE_SIZE);
  const paged = filtered.slice(
    (page - 1) * SEALED_PAGE_SIZE,
    page * SEALED_PAGE_SIZE,
  );

  return (
    <Stack gap="md">
      <Group gap="sm">
        <TextInput
          placeholder="Product name (e.g. Booster Box)"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          style={{ flex: 1 }}
          size="sm"
        />
        <CurrencyInput
          value={rrp}
          onChange={setRrp}
          placeholder="RRP"
          leftSection={<Text size="xs" c="dimmed">RM</Text>}
          size="sm"
          w={110}
        />
        <Button
          leftSection={<IconPlus size={13} />}
          size="sm"
          color="teal"
          onClick={handleAdd}
          loading={saving}
          disabled={!name.trim()}
        >
          Add product
        </Button>
      </Group>

      {sealedProducts.length > 0 && (
        <Group gap="sm">
          <TextInput
            placeholder="Search sealed…"
            leftSection={<IconSearch size={14} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            style={{ flex: 1 }}
            size="sm"
          />
          <Select
            data={SEALED_STOCK_FILTER_OPTIONS}
            value={stockFilter}
            onChange={(v) => setStockFilter(v ?? "all")}
            size="sm"
            w={130}
            allowDeselect={false}
          />
          <Select
            data={SEALED_SORT_OPTIONS}
            value={sort}
            onChange={(v) => setSort(v ?? "name-asc")}
            size="sm"
            w={160}
            allowDeselect={false}
          />
        </Group>
      )}

      {sealedProducts.length > 0 && (
        <Text size="xs" c="dimmed">
          {filtered.length} product{filtered.length !== 1 ? "s" : ""}
          {filtered.length !== sealedProducts.length
            ? ` of ${sealedProducts.length}`
            : ""}
        </Text>
      )}

      {sealedProducts.length === 0 ? (
        <Center py="xl">
          <Stack align="center" gap="xs">
            <ThemeIcon color="dark" variant="light" size="xl" radius="xl">
              <IconPackage size={20} />
            </ThemeIcon>
            <Text size="sm" c="dimmed">
              No sealed products yet.
            </Text>
          </Stack>
        </Center>
      ) : filtered.length === 0 ? (
        <Text size="xs" c="dimmed">
          No matches.
        </Text>
      ) : (
        <Stack gap="xs">
          {paged.map((p) => {
            const stock = sealedStockMap.get(p.name.toLowerCase());
            const isEditing = editingId === p.id;
            return (
              <Paper key={p.id} withBorder p="sm" radius="md">
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                    <ThemeIcon variant="light" color="teal" size="sm" radius="sm" style={{ flexShrink: 0 }}>
                      <IconPackage size={13} />
                    </ThemeIcon>
                    {isEditing ? (
                      <Group gap="xs" style={{ flex: 1 }} wrap="nowrap">
                        <TextInput
                          value={editingName}
                          onChange={(e) => setEditingName(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSave(p.id);
                            if (e.key === "Escape") cancelEdit();
                          }}
                          size="xs"
                          style={{ flex: 1 }}
                          autoFocus
                        />
                        <CurrencyInput
                          value={editingRrp}
                          onChange={setEditingRrp}
                          placeholder="RRP"
                          leftSection={<Text size="xs" c="dimmed">RM</Text>}
                          size="xs"
                          w={100}
                        />
                      </Group>
                    ) : (
                      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                        <Text size="sm" fw={500}>{p.name}</Text>
                        {p.recommendedRetailPriceMyr != null && (
                          <Text size="xs" c="dimmed">RRP {rm(p.recommendedRetailPriceMyr)}</Text>
                        )}
                      </Stack>
                    )}
                  </Group>
                  <Group gap="xs" wrap="nowrap">
                    {isEditing ? (
                      <>
                        <ActionIcon
                          size="sm"
                          color="teal"
                          variant="light"
                          loading={renaming}
                          disabled={
                            !editingName.trim() ||
                            (editingName.trim() === p.name &&
                              (editingRrp || null) === (p.recommendedRetailPriceMyr ?? null))
                          }
                          onClick={() => handleSave(p.id)}
                        >
                          <IconCheck size={13} />
                        </ActionIcon>
                        <ActionIcon size="sm" variant="subtle" color="gray" onClick={cancelEdit}>
                          <IconX size={13} />
                        </ActionIcon>
                      </>
                    ) : pendingDeleteId === p.id ? (
                      <>
                        <Text size="xs" c="dimmed">Delete?</Text>
                        <Button
                          size="xs"
                          color="red"
                          variant="light"
                          loading={deleting}
                          onClick={() => confirmDelete(p.id)}
                        >
                          Yes, delete
                        </Button>
                        <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => setPendingDeleteId(null)}>
                          <IconX size={13} />
                        </ActionIcon>
                      </>
                    ) : (
                      <>
                        {stock && stock.qty > 0 ? (
                          <Stack gap={1} align="flex-end" style={{ flexShrink: 0 }}>
                            <Badge color="violet" variant="light" size="sm">
                              ×{stock.qty}
                            </Badge>
                            <Text size="xs" c="dimmed">
                              avg {rm(stock.avgCost)}
                            </Text>
                          </Stack>
                        ) : (
                          <Text size="xs" c="dimmed">0 in stock</Text>
                        )}
                        <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => startEdit(p)}>
                          <IconPencil size={13} />
                        </ActionIcon>
                        <Tooltip
                          label="Sell or remove all stock before deleting"
                          disabled={!stock || stock.qty === 0}
                          withArrow
                        >
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="red"
                            disabled={!!stock && stock.qty > 0}
                            onClick={() => setPendingDeleteId(p.id)}
                          >
                            <IconTrash size={13} />
                          </ActionIcon>
                        </Tooltip>
                      </>
                    )}
                  </Group>
                </Group>
              </Paper>
            );
          })}
        </Stack>
      )}

      {totalPages > 1 && (
        <Pagination
          value={page}
          onChange={setPage}
          total={totalPages}
          size="sm"
          color="teal"
        />
      )}
    </Stack>
  );
}

// ─── Sort options ─────────────────────────────────────────────────────────────

const PAGE_SIZE_GRID = 24;
const PAGE_SIZE_LIST = 40;

const SORT_OPTIONS = [
  { value: "name-asc", label: "Name (A–Z)" },
  { value: "qty-desc", label: "Qty (high first)" },
  { value: "unit-desc", label: "Unit price" },
  { value: "market-desc", label: "Total market value" },
  { value: "gain-desc", label: "Unrealized gain" },
];

function applySort(items, sort) {
  const sorted = [...items];
  switch (sort) {
    case "qty-desc":
      return sorted.sort((a, b) => b.qty - a.qty);
    case "unit-desc":
      return sorted.sort((a, b) => (b.avgMarket ?? 0) - (a.avgMarket ?? 0));
    case "market-desc":
      return sorted.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));
    case "gain-desc":
      return sorted.sort(
        (a, b) => (b.unrealizedGain ?? 0) - (a.unrealizedGain ?? 0),
      );
    default:
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Stock() {
  const stock = useOrgStore((s) => s.stock);
  const events = useOrgStore((s) => s.events);
  const role = useOrgStore((s) => s.role);
  const org = useOrgStore((s) => s.org);
  const sealedProducts = useOrgStore((s) => s.sealedProducts);
  const addSealedProduct    = useOrgStore((s) => s.addSealedProduct);
  const updateSealedProductInStore = useOrgStore((s) => s.updateSealedProduct);
  const removeSealedProduct = useOrgStore((s) => s.removeSealedProduct);
  const { user } = useAuthStore();

  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, 250);
  const [sort, setSort] = useState("name-asc");
  const [eventFilter, setEventFilter] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [addStockOpen, setAddStockOpen] = useState(false);
  const [detailCard, setDetailCard] = useState(null);
  const [page, setPage] = useState(1);
  const viewportRef = useRef(null);
  const [view, setViewRaw] = useState(
    () => localStorage.getItem("stock_view") ?? "list",
  );
  const [priceOverrides, setPriceOverrides] = useState(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [localStock, setLocalStock] = useState(null); // null = use global store stock

  function setView(v) {
    setViewRaw(v);
    localStorage.setItem("stock_view", v);
  }

  const canImport = role === "owner" || role === "admin";

  // Card keys for price refresh — derived from global stock (not event-filtered),
  // since the price cache itself is org-wide.
  const cardIds = useMemo(
    () => stock.filter((r) => r.type === "card").map((r) => r.key),
    [stock],
  );

  const cardIdsKey = useMemo(() => [...cardIds].sort().join(","), [cardIds]);

  const doRefresh = useCallback(
    async (force = false) => {
      if (!cardIds.length) return;
      setRefreshing(true);
      try {
        const map = await refreshStaleCardPrices(cardIds, force);
        setPriceOverrides(new Map(map));
        setLastRefreshed(new Date());
      } catch (err) {
        console.error("price refresh error:", err);
      } finally {
        setRefreshing(false);
      }
    },
    [cardIds],
  );

  useEffect(() => {
    if (!cardIds.length) return;
    let cancelled = false;
    (async () => {
      setRefreshing(true);
      try {
        const map = await refreshStaleCardPrices(cardIds, false);
        if (!cancelled) {
          setPriceOverrides(new Map(map));
          setLastRefreshed(new Date());
        }
      } catch (err) {
        console.error("price refresh error:", err);
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardIdsKey]);

  const eventOptions = useMemo(() => {
    if (events.length === 0) return [];
    return [
      { value: "", label: "All events" },
      ...events.map((e) => ({ value: e.id, label: e.name ?? "Unnamed" })),
      { value: "__none__", label: "Walk-in" },
    ];
  }, [events]);

  // When an event filter is active, fetch event-scoped stock rows locally
  // (the store's global stock stays untouched for cart consumers).
  useEffect(() => {
    if (!eventFilter || !org?.id) {
      setLocalStock(null);
      return;
    }
    let cancelled = false;
    loadStock(org.id, { eventId: eventFilter })
      .then((rows) => {
        if (!cancelled) setLocalStock(rows);
      })
      .catch((err) => {
        console.error("event-scoped stock load error:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [eventFilter, org?.id]);

  const activeStock = localStock ?? stock;

  const allItems = useMemo(
    () =>
      Array.from(buildStockMapFromRows(activeStock, priceOverrides).values()),
    [activeStock, priceOverrides],
  );

  const cardItems = useMemo(
    () => allItems.filter((i) => i.type === "card"),
    [allItems],
  );

  const sealedStockMap = useMemo(() => {
    const m = new Map();
    for (const item of allItems) {
      if (item.type === "sealed") m.set(item.key, item);
    }
    return m;
  }, [allItems]);

  const filtered = useMemo(() => {
    // Per-item normalization happens server-side in get_org_stock (name_norm /
    // set_norm / number_norm). Only the search query itself needs normalization
    // on the client. Debounced so we don't run this on every keystroke.
    const q = normalizeStr(debouncedQuery.trim().toLowerCase());
    const matching = q
      ? cardItems.filter(
          (item) =>
            item.nameNorm.includes(q) ||
            item.setNorm.includes(q) ||
            item.numberNorm.includes(q),
        )
      : cardItems;
    return applySort(matching, sort);
  }, [cardItems, debouncedQuery, sort]);

  useEffect(() => {
    setPage(1);
  }, [filtered, view]);

  const pageSize = view === "grid" ? PAGE_SIZE_GRID : PAGE_SIZE_LIST;
  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalUnits = cardItems.reduce((sum, i) => sum + i.qty, 0);

  function handleExportCsv() {
    const esc = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const row = (...fields) => fields.map(esc).join(",");

    // Always export full org stock — ignore event filter and search.
    const items = Array.from(
      buildStockMapFromRows(stock, priceOverrides).values(),
    );

    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === "card" ? -1 : 1;
      if (a.type === "card") {
        return (
          (a.setName || "").localeCompare(b.setName || "") ||
          (a.name || "").localeCompare(b.name || "") ||
          (a.number || "").localeCompare(b.number || "")
        );
      }
      return (a.name || "").localeCompare(b.name || "");
    });

    const lines = [];
    lines.push(row("Company", org?.name ?? ""));
    lines.push(row("Report", "Stock Export"));
    lines.push(row("Exported", new Date().toISOString()));
    lines.push(row("Currency", "MYR"));
    lines.push("");
    lines.push(
      row(
        "Type",
        "Name",
        "Number",
        "Set",
        "Language",
        "Quantity",
        "AvgCost",
        "AvgMarket",
        "CostBasis",
        "MarketValue",
        "UnrealizedGain",
        "ImageUrl",
        "Key",
      ),
    );

    for (const it of items) {
      if (it.type === "card") {
        lines.push(
          row(
            "card",
            it.name,
            it.number,
            it.setName,
            it.lang,
            it.qty,
            it.avgCost.toFixed(2),
            it.avgMarket.toFixed(2),
            it.costBasis.toFixed(2),
            it.marketValue.toFixed(2),
            it.unrealizedGain.toFixed(2),
            it.imageUrl ?? "",
            it.key,
          ),
        );
      } else {
        lines.push(
          row(
            "sealed",
            it.name,
            "",
            "",
            "",
            it.qty,
            it.avgCost.toFixed(2),
            "",
            it.costBasis.toFixed(2),
            "",
            "",
            "",
            it.key,
          ),
        );
      }
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Box
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <Tabs
        defaultValue="cards"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        <Tabs.List px="md" pt="xs">
          <Tabs.Tab value="cards">Cards</Tabs.Tab>
          <Tabs.Tab value="sealed" leftSection={<IconPackage size={13} />}>
            Sealed
          </Tabs.Tab>
        </Tabs.List>

        {/* ── Cards tab ────────────────────────────────────────────────────── */}
        <Tabs.Panel
          value="cards"
          style={{ flex: 1, overflow: "hidden", minHeight: 0 }}
        >
          <ScrollArea
            style={{ height: "100%" }}
            p="md"
            viewportRef={viewportRef}
          >
            <Stack gap="md" pb="md">
              <Group gap="sm">
                <TextInput
                  placeholder="Search cards…"
                  leftSection={<IconSearch size={14} />}
                  value={query}
                  onChange={(e) => setQuery(e.currentTarget.value)}
                  style={{ flex: 1 }}
                  size="sm"
                />
                {eventOptions.length > 0 && (
                  <Select
                    data={eventOptions}
                    value={eventFilter}
                    onChange={(v) => setEventFilter(v ?? "")}
                    size="sm"
                    w={150}
                    allowDeselect={false}
                  />
                )}
                <Select
                  data={SORT_OPTIONS}
                  value={sort}
                  onChange={(v) => setSort(v ?? "name-asc")}
                  size="sm"
                  w={160}
                  allowDeselect={false}
                />
                {canImport && (
                  <Button
                    variant="light"
                    size="sm"
                    leftSection={<IconUpload size={13} />}
                    onClick={() => setImportOpen(true)}
                  >
                    Import
                  </Button>
                )}
                <Button
                  variant="light"
                  color="teal"
                  size="sm"
                  leftSection={<IconDownload size={13} />}
                  onClick={handleExportCsv}
                  disabled={stock.length === 0}
                >
                  Export
                </Button>
                <Group gap={4}>
                  <ActionIcon
                    variant={view === "list" ? "light" : "subtle"}
                    color={view === "list" ? "violet" : "gray"}
                    size="sm"
                    onClick={() => setView("list")}
                  >
                    <IconLayoutList size={15} />
                  </ActionIcon>
                  <ActionIcon
                    variant={view === "grid" ? "light" : "subtle"}
                    color={view === "grid" ? "violet" : "gray"}
                    size="sm"
                    onClick={() => setView("grid")}
                  >
                    <IconLayoutGrid size={15} />
                  </ActionIcon>
                </Group>
              </Group>

              {cardItems.length > 0 && (
                <Group gap="xs" align="center">
                  <Text size="xs" c="dimmed">
                    {cardItems.length} unique card
                    {cardItems.length !== 1 ? "s" : ""} · {totalUnits} total
                    unit{totalUnits !== 1 ? "s" : ""}
                  </Text>
                  {lastRefreshed && (
                    <Text size="xs" c="dimmed">
                      · prices{" "}
                      {lastRefreshed.toLocaleTimeString("en-MY", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </Text>
                  )}
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color="gray"
                    loading={refreshing}
                    onClick={() => doRefresh(true)}
                    title="Force refresh prices"
                  >
                    <IconRefresh size={11} />
                  </ActionIcon>
                </Group>
              )}

              {filtered.length === 0 ? (
                query ? (
                  <Text size="xs" c="dimmed">
                    No matches.
                  </Text>
                ) : (
                  <Center py="xl">
                    <Stack align="center" gap="xs">
                      <ThemeIcon
                        color="dark"
                        variant="light"
                        size="xl"
                        radius="xl"
                      >
                        <IconPackage size={20} />
                      </ThemeIcon>
                      <Text size="sm" c="dimmed">
                        No cards on hand.
                      </Text>
                    </Stack>
                  </Center>
                )
              ) : view === "list" ? (
                <Stack gap="sm">
                  {paged.map((item) => (
                    <StockRow key={item.key} item={item} />
                  ))}
                </Stack>
              ) : (
                <Box
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(150px, 1fr))",
                    gap: "var(--mantine-spacing-sm)",
                  }}
                >
                  {paged.map((item) => (
                    <StockGridItem
                      key={item.key}
                      item={item}
                      onCardClick={(id, imageUrl) =>
                        setDetailCard({ id, imageUrl })
                      }
                    />
                  ))}
                </Box>
              )}

              {totalPages > 1 && (
                <Pagination
                  value={page}
                  onChange={(p) => {
                    setPage(p);
                    viewportRef.current?.scrollTo({ top: 0 });
                  }}
                  total={totalPages}
                  size="sm"
                  color="violet"
                />
              )}
            </Stack>
          </ScrollArea>
        </Tabs.Panel>

        {/* ── Sealed tab ───────────────────────────────────────────────────── */}
        <Tabs.Panel
          value="sealed"
          style={{ flex: 1, overflow: "hidden", minHeight: 0 }}
        >
          <ScrollArea style={{ height: "100%" }} p="md">
            <Stack gap="md" pb="md">
              <SealedCatalog
                sealedProducts={sealedProducts}
                addSealedProduct={addSealedProduct}
                updateSealedProduct={updateSealedProductInStore}
                removeSealedProduct={removeSealedProduct}
                sealedStockMap={sealedStockMap}
                orgId={org?.id}
                userId={user?.dbId}
              />
            </Stack>
          </ScrollArea>
        </Tabs.Panel>
      </Tabs>

      <ImportModal opened={importOpen} onClose={() => setImportOpen(false)} />
      <AddStockModal
        opened={addStockOpen}
        onClose={() => setAddStockOpen(false)}
      />
      <CardDetailModal
        cardExternalId={detailCard?.id ?? null}
        fallbackImageUrl={detailCard?.imageUrl ?? null}
        onClose={() => setDetailCard(null)}
      />
    </Box>
  );
}
