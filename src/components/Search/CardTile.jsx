import { useState } from 'react';
import { Box, Text, Overlay, Center, Loader } from '@mantine/core';
import { getTcgplayerImageUrl } from '../../lib/pokewallet';

export default function CardTile({ card, onSelect }) {
  const [selecting, setSelecting] = useState(false);

  const imageUrl = card.tcgplayer?.url
    ? getTcgplayerImageUrl(card.tcgplayer.url)
    : null;

  async function handleTap() {
    if (selecting) return;
    setSelecting(true);
    try {
      await onSelect(card);
    } finally {
      setSelecting(false);
    }
  }

  return (
    <Box
      onClick={handleTap}
      style={{ cursor: 'pointer', userSelect: 'none' }}
    >
      {/* Fixed-ratio image container — no layout jump as images load */}
      <Box
        style={{
          position:     'relative',
          aspectRatio:  '245 / 337',
          background:   'var(--mantine-color-dark-6)',
          borderRadius: 4,
          overflow:     'hidden',
        }}
      >
        {imageUrl && (
          <img
            src={imageUrl}
            loading="lazy"
            alt={card.card_info?.name ?? ''}
            style={{
              width:      '100%',
              height:     '100%',
              objectFit:  'cover',
              display:    'block',
            }}
          />
        )}

        {selecting && (
          <Overlay backgroundOpacity={0.4} radius={4}>
            <Center h="100%">
              <Loader size="sm" color="violet" />
            </Center>
          </Overlay>
        )}
      </Box>

      {/* Text block — min 44px for tap target */}
      <Box p={6} style={{ minHeight: 44 }}>
        <Text size="13px" fw={500} lineClamp={1}>
          {card.card_info?.name ?? '—'}
        </Text>
        <Text size="11px" c="dimmed" lineClamp={1}>
          {[card.card_info?.set_name, card.card_info?.card_number]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </Box>
    </Box>
  );
}
