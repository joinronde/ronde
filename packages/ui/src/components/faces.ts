import { lorelei } from "@dicebear/collection";
import { createAvatar } from "@dicebear/core";

// The six people of Ronde's illustrations (sign-in pages, marketing site), drawn on the server (Lorelei by
// Lisa Wischofsky, CC0): the browser only receives the pictures. Hair goes with the first name; everyone is in a good mood.

const PEOPLE = [
  { name: "Emma", bg: "ffd2ad", hair: "variant16", mouth: "happy05", eyes: "variant24", eyebrows: "variant02", flower: true },
  { name: "Lucas", bg: "f2eee8", hair: "variant04", mouth: "happy05", eyes: "variant24", eyebrows: "variant01" },
  { name: "Sarah", bg: "fee2c5", hair: "variant35", mouth: "happy04", eyes: "variant15", eyebrows: "variant09" },
  { name: "Tom", bg: "e7d7c1", hair: "variant08", mouth: "happy05", eyes: "variant19", eyebrows: "variant02", glasses: "variant02" },
  { name: "Sofia", bg: "fde8d7", hair: "variant21", mouth: "happy05", eyes: "variant24", eyebrows: "variant01" },
  { name: "Hugo", bg: "efe3cf", hair: "variant39", mouth: "happy04", eyes: "variant20", eyebrows: "variant09", beard: "variant01" },
] as const;

export interface Face {
  name: string;
  src: string;
}

let cached: Face[] | null = null;

export function roundTableFaces(): Face[] {
  cached ??= PEOPLE.map((p) => ({
    name: p.name,
    src: createAvatar(lorelei, {
      seed: `ronde-${p.name}`,
      backgroundColor: [p.bg],
      radius: 50,
      hair: [p.hair],
      mouth: [p.mouth],
      eyes: [p.eyes],
      eyebrows: [p.eyebrows],
      ...("beard" in p ? { beard: [p.beard], beardProbability: 100 } : { beardProbability: 0 }),
      ...("glasses" in p ? { glasses: [p.glasses], glassesProbability: 100 } : { glassesProbability: 0 }),
      ...("flower" in p ? { hairAccessories: ["flowers" as const], hairAccessoriesProbability: 100 } : { hairAccessoriesProbability: 0 }),
      earringsProbability: 0,
    }).toDataUri(),
  }));
  return cached;
}
