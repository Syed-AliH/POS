type SortableThProps<K extends string> = {
  label: string;
  columnKey: K;
  onSort: (key: K) => void;
  icon: (key: K) => string;
  className?: string;
  align?: 'left' | 'right' | 'center';
};

export function SortableTh<K extends string>({
  label,
  columnKey,
  onSort,
  icon,
  className = '',
  align = 'left',
}: SortableThProps<K>) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      className={`cursor-pointer select-none hover:text-primary-700 dark:hover:text-primary-400 ${alignClass} ${className}`}
      onClick={() => onSort(columnKey)}
    >
      {label}
      {icon(columnKey)}
    </th>
  );
}
