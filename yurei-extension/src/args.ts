import { type Args, isRecord } from "../../shared/protocol";

export class ArgError extends Error {}

export function optString(args: Args, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v !== "string") throw new ArgError(`"${key}" must be a string`);
  return v;
}

export function reqString(args: Args, key: string): string {
  const v = optString(args, key);
  if (v === undefined || v === "") throw new ArgError(`"${key}" is required`);
  return v;
}

const toFinite = (v: unknown): number | undefined => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

export function optNumber(args: Args, key: string): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  const n = toFinite(v);
  if (n === undefined) throw new ArgError(`"${key}" must be a number`);
  return n;
}

export function reqNumber(args: Args, key: string): number {
  const v = optNumber(args, key);
  if (v === undefined) throw new ArgError(`"${key}" is required`);
  return v;
}

export function optBoolean(args: Args, key: string): boolean | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new ArgError(`"${key}" must be a boolean`);
}

export function optEnum<T extends string>(args: Args, key: string, values: ReadonlyArray<T>): T | undefined {
  const v = optString(args, key);
  if (v === undefined) return undefined;
  const hit = values.find((x) => x === v.toLowerCase());
  if (!hit) throw new ArgError(`"${key}" must be one of: ${values.join(", ")}`);
  return hit;
}

export function reqEnum<T extends string>(args: Args, key: string, values: ReadonlyArray<T>): T {
  const v = optEnum(args, key, values);
  if (v === undefined) throw new ArgError(`"${key}" is required (one of: ${values.join(", ")})`);
  return v;
}

export type Coordinate = readonly [number, number];

export function optCoordinate(args: Args, key: string): Coordinate | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v) && v.length === 2) {
    const x = toFinite(v[0]);
    const y = toFinite(v[1]);
    if (x !== undefined && y !== undefined) return [x, y];
  }
  if (isRecord(v)) {
    const x = toFinite(v["x"]);
    const y = toFinite(v["y"]);
    if (x !== undefined && y !== undefined) return [x, y];
  }
  if (typeof v === "string") {
    const parts = v.split(/[,\s]+/).map(toFinite);
    if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) return [parts[0], parts[1]];
  }
  throw new ArgError(`"${key}" must be [x, y]`);
}
