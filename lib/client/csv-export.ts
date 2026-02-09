type CsvCell = string | number | boolean | null | undefined;

type CsvMetaItem = {
  key: string;
  value: CsvCell;
};

const escapeCsvCell = (value: string): string => {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

const normalizeCsvCell = (value: CsvCell): string => {
  if (value === null || value === undefined) return '';
  return String(value);
};

const pad2 = (value: number): string => `${value}`.padStart(2, '0');

export const formatTimestampForFilename = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = pad2(date.getUTCMonth() + 1);
  const day = pad2(date.getUTCDate());
  const hours = pad2(date.getUTCHours());
  const minutes = pad2(date.getUTCMinutes());
  const seconds = pad2(date.getUTCSeconds());
  return `${year}${month}${day}_${hours}${minutes}${seconds}Z`;
};

export const downloadCsvWithBom = (
  filename: string,
  headers: string[],
  rows: Array<Array<CsvCell>>,
  meta: CsvMetaItem[] = [],
): void => {
  const metaLines = meta.map((item) => [
    escapeCsvCell(item.key),
    escapeCsvCell(normalizeCsvCell(item.value)),
  ].join(','));

  const headerLine = headers.map((header) => escapeCsvCell(header)).join(',');
  const rowLines = rows.map((row) => row.map((cell) => escapeCsvCell(normalizeCsvCell(cell))).join(','));

  const lines = [
    ...metaLines,
    ...(metaLines.length > 0 ? [''] : []),
    headerLine,
    ...rowLines,
  ];

  const csvContent = `\uFEFF${lines.join('\r\n')}`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
