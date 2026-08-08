/* eslint-disable @typescript-eslint/no-explicit-any */
import { TreeNode, RBXLXProperty, ParsedRBXLX } from "@/types/rbxlx";

// Long-key format (ours / Bevy plugin).
interface MapPartJson {
  Type?: string;
  Position?: [number, number, number];
  Rotation?: [number, number, number];
  Size?: [number, number, number];
  Color?: string;
  Transparency?: number;
  Shape?: string;
  CantCollide?: boolean;
}

// Short-key format used by Vortex map dumps. Same fields, renamed.
// Rotation is stored in radians; we convert to degrees so the rest of the
// pipeline treats it like a "ours"-format part.
interface VortexPart {
  T?: string;
  P?: [number, number, number];
  R?: [number, number, number];
  S?: [number, number, number];
  C?: string;
  Tr?: number;
  Sh?: string;
}

const RAD_TO_DEG = 180 / Math.PI;

function normalizeVortex(v: VortexPart): MapPartJson {
  const rad = v.R;
  const rotation: [number, number, number] | undefined = Array.isArray(rad)
    ? [Number(rad[0]) * RAD_TO_DEG, Number(rad[1]) * RAD_TO_DEG, Number(rad[2]) * RAD_TO_DEG]
    : undefined;
  return {
    Type: v.T,
    Position: v.P,
    Rotation: rotation,
    Size: v.S,
    Color: v.C,
    Transparency: v.Tr,
    Shape: v.Sh,
    // Vortex implies CanCollide = true everywhere; leave CantCollide undefined
    // so the defaulting logic later picks false (= collidable).
  };
}

function isVortexEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  // Short-form keys present and long-form keys absent ⇒ Vortex.
  return (
    ("T" in e || "P" in e || "S" in e || "R" in e || "Sh" in e) &&
    !("Type" in e) &&
    !("Position" in e)
  );
}

function vec3(
  raw: unknown,
  fallback: [number, number, number]
): [number, number, number] {
  if (!Array.isArray(raw)) return fallback;
  const x = Number(raw[0]);
  const y = Number(raw[1]);
  const z = Number(raw[2]);
  return [
    Number.isFinite(x) ? x : fallback[0],
    Number.isFinite(y) ? y : fallback[1],
    Number.isFinite(z) ? z : fallback[2],
  ];
}

const DEG_TO_RAD = Math.PI / 180;

// Build a row-major 3x3 rotation matrix from XYZ intrinsic Euler degrees,
// matching Roblox / Bevy's R = Rx(x) * Ry(y) * Rz(z) convention.
function eulerXYZDegToMatrix(xd: number, yd: number, zd: number) {
  const x = xd * DEG_TO_RAD;
  const y = yd * DEG_TO_RAD;
  const z = zd * DEG_TO_RAD;
  const cx = Math.cos(x), sx = Math.sin(x);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cz = Math.cos(z), sz = Math.sin(z);
  return {
    R00: cy * cz,
    R01: -cy * sz,
    R02: sy,
    R10: sx * sy * cz + cx * sz,
    R11: -sx * sy * sz + cx * cz,
    R12: -sx * cy,
    R20: -cx * sy * cz + sx * sz,
    R21: cx * sy * sz + sx * cz,
    R22: cx * cy,
  };
}

function hexToColor3uint8(hex: string): number {
  const clean = hex.replace(/^#/, "").trim();
  if (clean.length !== 6) return 0xffa3a2a5 | 0;
  const r = parseInt(clean.slice(0, 2), 16) & 0xff;
  const g = parseInt(clean.slice(2, 4), 16) & 0xff;
  const b = parseInt(clean.slice(4, 6), 16) & 0xff;
  // 0xAARRGGBB packing — Roblox's Color3uint8 stores alpha in the top byte.
  return (((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0);
}

function classFor(type: string, shape: string): string {
  if (type === "SpawnLocation") return "SpawnLocation";
  if (type === "Seat") return "Seat";
  if (shape === "Wedge") return "WedgePart";
  if (shape === "CornerWedge") return "CornerWedgePart";
  return "Part";
}

function shapeToken(shape: string): number {
  if (shape === "Ball") return 0;
  if (shape === "Cylinder" || shape === "Cylinder2") return 2;
  return 1; // Block
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

// Wrap a value into the {original, value, type, name} shape extractParts /
// convertMapJson / PropertyEditor expect, so the rest of the app can stay
// format-agnostic.
function prop(
  name: string,
  type: string,
  value: any,
  original: Record<string, any>
): RBXLXProperty {
  return { name, type, value, original };
}

export function parseMapJson(content: string): ParsedRBXLX {
  const data = JSON.parse(content);
  if (!Array.isArray(data)) {
    throw new Error("Expected a JSON array of map parts");
  }

  const partNodes: TreeNode[] = data.map((raw: unknown, i: number) => {
    const entry: MapPartJson = isVortexEntry(raw)
      ? normalizeVortex(raw as VortexPart)
      : (raw as MapPartJson);
    const type = entry.Type ?? "Part";
    const shape = entry.Shape ?? "Block";
    const cls = classFor(type, shape);
    const position = vec3(entry.Position, [0, 0, 0]);
    const rotation = vec3(entry.Rotation, [0, 0, 0]);
    const size = vec3(entry.Size, [1, 1, 1]);
    const rot = eulerXYZDegToMatrix(rotation[0], rotation[1], rotation[2]);
    const cframeOriginal = {
      X: position[0],
      Y: position[1],
      Z: position[2],
      ...rot,
    };
    const sizeOriginal = { X: size[0], Y: size[1], Z: size[2] };
    const colorPacked = hexToColor3uint8(entry.Color ?? "a3a2a5");
    const transparency =
      typeof entry.Transparency === "number" ? entry.Transparency : 0;
    const canCollide = entry.CantCollide === true ? false : true;

    const displayName = `${type} ${i + 1}`;
    const properties: RBXLXProperty[] = [
      prop("Name", "string", displayName, {
        "@_name": "Name",
        value: displayName,
      }),
      prop(
        "size",
        "Vector3",
        `${sizeOriginal.X}, ${sizeOriginal.Y}, ${sizeOriginal.Z}`,
        sizeOriginal
      ),
      prop(
        "CFrame",
        "CoordinateFrame",
        Object.values(cframeOriginal).join(" "),
        cframeOriginal
      ),
      prop("Color3uint8", "Color3uint8", colorPacked, {
        "@_name": "Color3uint8",
        value: colorPacked,
      }),
      prop("Transparency", "float", transparency, {
        "@_name": "Transparency",
        value: transparency,
      }),
      prop("CanCollide", "bool", canCollide, {
        "@_name": "CanCollide",
        value: canCollide,
      }),
    ];

    if (cls === "Part") {
      const token = shapeToken(shape);
      properties.push(
        prop("shape", "token", token, { "@_name": "shape", value: token })
      );
    }

    return {
      id: generateId(),
      name: displayName,
      class: cls,
      properties,
    };
  });

  // Mimic the rbxlx tree shape so handlers that walk for Workspace (the spawn
  // injector, for one) still find a sensible parent for these parts.
  const workspaceNode: TreeNode = {
    id: "workspace",
    name: "Workspace",
    class: "Workspace",
    properties: [],
    children: partNodes,
  };

  return {
    raw: { __mapJsonSource: true } as any,
    tree: [workspaceNode],
  };
}

// Quick sniff so the file-upload path can branch without trusting extensions.
export function looksLikeMapJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("[") || t.startsWith("{");
}
