import { DEMO_MODE, GOOGLE_PLACES_KEY } from '../config';
import { PlaceResult } from '../types';

/**
 * Restaurant search. Production: Google Places API (New) Text Search.
 * Demo mode (or no key): a small built-in list so tagging is testable.
 */
export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  const q = query.trim();
  if (!q) return [];
  if (DEMO_MODE || !GOOGLE_PLACES_KEY) {
    await new Promise((r) => setTimeout(r, 300));
    return DEMO_PLACES.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  }
  try {
    const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.location',
      },
      body: JSON.stringify({ textQuery: q, includedType: 'restaurant', maxResultCount: 8 }),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.places ?? []).map((p: any) => ({
      place_id: p.id,
      name: p.displayName?.text ?? 'Unknown',
      address: p.formattedAddress ?? '',
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
    }));
  } catch {
    return [];
  }
}

const DEMO_PLACES: PlaceResult[] = [
  { place_id: 'demo-bg-milkyway', name: 'B&G Milkyway', address: '3200 W 41st St, Sioux Falls, SD', lat: 43.5446, lng: -96.7311 },
  { place_id: 'demo-el-jefe', name: 'El Jefe Taqueria', address: '1000 N Main Ave, Sioux Falls, SD', lat: 43.5383, lng: -96.7402 },
  { place_id: 'demo-phillips', name: 'Phillips Avenue Diner', address: '121 S Phillips Ave, Sioux Falls, SD', lat: 43.5455, lng: -96.7264 },
  { place_id: 'demo-breadico', name: 'Breadico', address: '201 W 37th St, Sioux Falls, SD', lat: 43.5219, lng: -96.7296 },
  { place_id: 'demo-chickfila', name: 'Chick-fil-A', address: '2601 S Louise Ave, Sioux Falls, SD', lat: 43.5252, lng: -96.7756 },
  { place_id: 'demo-parlour', name: 'Parlour Ice Cream House', address: '325 S Phillips Ave, Sioux Falls, SD', lat: 43.5432, lng: -96.7262 },
  { place_id: 'demo-mackenzie', name: "MacKenzie River Pizza", address: '4901 E 26th St, Sioux Falls, SD', lat: 43.5347, lng: -96.6538 },
  { place_id: 'demo-oshima', name: 'Oshima Sushi', address: '2101 W 41st St, Sioux Falls, SD', lat: 43.5262, lng: -96.7614 },
];
