// Order 17, override 2: a map image appears on a zone card only if its wiki file page states its licence and its
// author or source. This is the record of that check, keyed by the reference exactly as each source writes it
// (mnm-tools maps.json "source", Mo Betta zones.json "map_file"). A reference missing here gets no image.
//
// The live wiki is never contacted (ORDER-RULES order 14: "Nothing else contacts the wiki"), so each entry was read
// from an archived copy of the file page; `evidence` is that copy.

export interface MapLicence {
  licence: string;
  licence_url: string;
  /** The map's author as the file page names it, or null when it names only a source. */
  author: string | null;
  /** Where the image comes from, for the credit line ("via …"). */
  via: string;
  /** The wiki file page that states the licence (the card links it). */
  page: string;
  /** The archived copy the check read, and when. */
  evidence: string;
  checked: string;
}

// The check of 2026-10-21 (order 17), through the Wayback Machine's CDX index of each file page:
// - no archived copy: Irem.png, MAP_GrimtideSanctum.png, Rothold_map_by_skoop.png, Shallowshoalseg.png (the four
//   mnm-tools sources), and Ancient_Crypt_Map.png, Fallen_watch_map_by_skoop.png, Glass_Flats_Map.png,
//   Great_Cavern_Sea_Map.png, Infested_Crypt_Map.png, BadShallowShoalMap.png, Vale_of_Zintar_Map.png;
// - archived, but naming no author or source (only the uploader and the site-wide CC BY-SA 4.0 footer):
//   Shaded_Dunes_Map.jpg (web.archive.org/web/20250628103018), Underdocks_map.png (web.archive.org/web/20261010232859).
// So no map qualifies today, and every zone card shows "No map yet" with the MnM Atlas link.
export const MAP_LICENCES: Record<string, MapLicence> = {};
