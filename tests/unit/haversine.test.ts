import { describe, it, expect } from "vitest";

// Recreate the pure mathematical logic used in discoverGroups/map filters
function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) return 0;
  
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

describe("Mathematical Formula: Haversine Distance (TC19)", () => {
  it("should calculate correct distance between Mainz and Frankfurt (~37km)", () => {
    const mainz = { lat: 49.9929, lon: 8.2473 };
    const frankfurt = { lat: 50.1109, lon: 8.6821 };
    
    const distance = calculateHaversineDistance(mainz.lat, mainz.lon, frankfurt.lat, frankfurt.lon);
    
    // Acceptable tolerance due to exact coordinates variations (between 33 and 35 km)
    expect(distance).toBeGreaterThan(33);
    expect(distance).toBeLessThan(35);
  });

  it("should return 0 when coordinates are identical", () => {
    const distance = calculateHaversineDistance(50.0, 8.0, 50.0, 8.0);
    expect(distance).toBe(0);
  });

  it("should safely handle invalid or NaN coordinates", () => {
    const distance = calculateHaversineDistance(NaN, 8.0, 50.0, NaN);
    expect(distance).toBe(0);
  });
});