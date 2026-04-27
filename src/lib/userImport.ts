export type ParsedImportedUser = {
  user_id_hash: string;
  first_name: string;
  last_name: string;
  email: string;
  title: string;
  initial_user_type: number;
  status: "invited" | "active" | "inactive" | "suspended";
  group_name: string;
};

const headerAliases: Record<string, keyof ParsedImportedUser> = {
  user_id_hash: "user_id_hash",
  user_hash: "user_id_hash",
  id: "user_id_hash",
  first_name: "first_name",
  firstname: "first_name",
  last_name: "last_name",
  lastname: "last_name",
  email: "email",
  title: "title",
  role: "title",
  initial_user_type: "initial_user_type",
  user_type: "initial_user_type",
  summary_type: "initial_user_type",
  status: "status",
  group: "group_name",
  group_name: "group_name",
};

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function detectDelimiter(line: string) {
  return line.includes("\t") ? "\t" : ",";
}

function splitLine(line: string, delimiter: string) {
  return line.split(delimiter).map((value) => value.trim());
}

function isHeaderRow(cells: string[]) {
  return cells.some((cell) => normalizeHeader(cell) in headerAliases);
}

function toStatus(value: string): ParsedImportedUser["status"] {
  if (value === "active" || value === "inactive" || value === "suspended") {
    return value;
  }
  return "invited";
}

function toInitialUserType(value: string): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 9) {
    return parsed;
  }
  return 1;
}

export function parseImportedUsers(text: string): ParsedImportedUser[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return [];
  }

  const delimiter = detectDelimiter(lines[0]);
  const firstCells = splitLine(lines[0], delimiter);
  const hasHeader = isHeaderRow(firstCells);

  const headers: Array<keyof ParsedImportedUser | null> = hasHeader
    ? firstCells.map((cell) => headerAliases[normalizeHeader(cell)] ?? null)
    : ["email", "first_name", "last_name", "title", "group_name", "status", "user_id_hash", "initial_user_type"];

  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines
    .map((line) => {
      const cells = splitLine(line, delimiter);
      const mapped: Partial<ParsedImportedUser> = {};

      headers.forEach((header, headerIndex) => {
        if (!header) {
          return;
        }
        mapped[header] = (cells[headerIndex] ?? "") as never;
      });

      const email = (mapped.email ?? "").trim();
      const first_name = (mapped.first_name ?? "").trim();
      const last_name = (mapped.last_name ?? "").trim();
      const title = (mapped.title ?? "").trim();
      const initial_user_type = toInitialUserType(String(mapped.initial_user_type ?? "").trim());
      const group_name = (mapped.group_name ?? "").trim();
      const status = toStatus((mapped.status ?? "").trim().toLowerCase());
      const user_id_hash = (mapped.user_id_hash ?? "").trim();

      if (!email && !user_id_hash) {
        return null;
      }

      return {
        user_id_hash,
        first_name,
        last_name,
        email,
        title,
        initial_user_type,
        status,
        group_name,
      };
    })
    .filter((item): item is ParsedImportedUser => Boolean(item));
}
