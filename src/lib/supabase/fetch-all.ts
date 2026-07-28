type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

/**
 * Fetches a stable ordered Supabase query in pages so dashboards never silently
 * become "latest N rows" reports. The caller must include a deterministic order.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  label: string,
  pageSize = 1_000,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to fetch ${label}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}
