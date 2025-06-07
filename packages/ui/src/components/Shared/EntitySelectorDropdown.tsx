// packages/ui/src/components/Shared/EntitySelectorDropdown.tsx
import React from 'react';
import { Select, Text } from '@radix-ui/themes';
import { formatTimestamp } from '../../helpers';

interface SelectableItem {
  id: number;
  name?: string | null;
  timestamp: number; // For default naming
}

interface EntitySelectorDropdownProps<T extends SelectableItem> {
  items: T[];
  activeItemId: number | null;
  onItemSelect: (id: number) => void;
  placeholderText: string;
  entityTypeLabel: string; // e.g., "Chat" or "Session"
  disabled?: boolean;
}

export function EntitySelectorDropdown<T extends SelectableItem>({
  items,
  activeItemId,
  onItemSelect,
  placeholderText,
  entityTypeLabel,
  disabled = false,
}: EntitySelectorDropdownProps<T>) {
  const getDisplayTitle = (item: T | undefined): string => {
    if (!item) return placeholderText;
    return (
      item.name || `${entityTypeLabel} (${formatTimestamp(item.timestamp)})`
    );
  };

  const activeItem = items.find((item) => item.id === activeItemId);
  // The Select.Root's value should be the string representation of the item's ID.
  // If no item is active, or items array is empty, it should be undefined or an empty string
  // to show the placeholder. Radix typically uses an empty string for this.
  const displayValue = activeItem ? String(activeItem.id) : '';

  return (
    <Select.Root
      value={displayValue}
      onValueChange={(value) => {
        // Value will be the string ID. Convert to number before calling onItemSelect.
        // Value can also be an empty string if the placeholder is re-selected or cleared,
        // but our logic only calls onItemSelect if value is truthy.
        if (value) {
          onItemSelect(Number(value));
        }
      }}
      disabled={disabled || items.length === 0}
      size="2"
    >
      <Select.Trigger
        placeholder={getDisplayTitle(undefined)} // This shows placeholderText
        style={{ flexGrow: 1, minWidth: 0, maxWidth: '300px' }}
        title={getDisplayTitle(activeItem)} // Tooltip for the active item
        className="truncate"
      />
      <Select.Content position="popper">
        {/*
          If items.length is 0, the Select.Trigger's placeholder will be shown
          because the Select.Root's value will be "" (empty string) and no items will be rendered.
          We don't need to render a special "No items available" Select.Item.
          The disabled state of Select.Root already handles interactivity.
        */}
        {items.map((item) => (
          <Select.Item key={item.id} value={String(item.id)}>
            <Text truncate title={getDisplayTitle(item)}>
              {getDisplayTitle(item)}
            </Text>
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
