import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toggleVenueAttendance, getVenues } from '@/app/actions/map';
import { prisma } from '@/lib/prisma';


vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: vi.fn(() => ({ value: 'fake-user-id' }))
  }))
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    venue: {
      findMany: vi.fn()
    },
    group: {
      findUnique: vi.fn()
    },
    venueAttendance: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn()
    }
  }
}));


describe('Map Server Actions (Unit)', () => {
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getVenues', () => {
    it('should return a list of venues with attendees', async () => {
      
      const mockDate = new Date('2026-06-07T12:00:00Z');
      const mockVenues = [{ 
        id: 'venue-1', 
        name: 'Schon Schön', 
        createdAt: mockDate,
        attendees: []
      }];
      
      (prisma.venue.findMany as any).mockResolvedValue(mockVenues);

      const result = await getVenues();

      expect(prisma.venue.findMany).toHaveBeenCalled();
      expect(result).toEqual([{
        ...mockVenues[0],
        createdAt: mockDate.toISOString()
      }]);
    });

    it('should return an empty array if a database error occurs', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (prisma.venue.findMany as any).mockRejectedValue(new Error('Database Connection Error'));

      const result = await getVenues();

      expect(result).toEqual([]);
      
      consoleSpy.mockRestore();
    });
  });

  describe('toggleVenueAttendance', () => {
    it('should return an error if the user has not created a group', async () => {
      (prisma.group.findUnique as any).mockResolvedValue(null);

      const result = await toggleVenueAttendance('venue-123');

      expect(result).toEqual({ error: "You have to create a group first" });
      expect(prisma.venueAttendance.create).not.toHaveBeenCalled();
    });

    it('should delete previous attendance and register a new one (switch venue)', async () => {
      (prisma.group.findUnique as any).mockResolvedValue({ id: 'group-123' });
      
      (prisma.venueAttendance.findUnique as any).mockResolvedValue(null);

      const result = await toggleVenueAttendance('new-venue-456');

      expect(prisma.venueAttendance.deleteMany).toHaveBeenCalledWith({
        where: { groupId: 'group-123' }
      });
      expect(prisma.venueAttendance.create).toHaveBeenCalledWith({
        data: {
          groupId: 'group-123',
          venueId: 'new-venue-456'
        }
      });
      expect(result).toEqual({ success: true, isAttending: true });
    });

    it('should remove attendance if the user is already attending the same venue (leave venue)', async () => {
      (prisma.group.findUnique as any).mockResolvedValue({ id: 'group-123' });
      
      (prisma.venueAttendance.findUnique as any).mockResolvedValue({ id: 'existing-attendance-789' });

      const result = await toggleVenueAttendance('venue-123');

      expect(prisma.venueAttendance.delete).toHaveBeenCalledWith({
        where: { id: 'existing-attendance-789' }
      });
      expect(prisma.venueAttendance.create).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, isAttending: false });
    });
  });

  describe('Geolocation Error Handling & Alert Modal Logic', () => {
    const defaultCenter: [number, number] = [49.9929, 8.2473]; // Mainz

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    // Helper that executes the same requestLocation logic used in MapDisplay.tsx
    const runRequestLocation = (
      geolocationObj: any,
      state: {
        userPosition: [number, number];
        showGeoModal: boolean;
        geoError: number | null;
        isLocating: boolean;
      }
    ) => {
      if (!geolocationObj) {
        state.geoError = 2;
        state.showGeoModal = true;
        return;
      }

      state.isLocating = true;
      geolocationObj.getCurrentPosition(
        (position: any) => {
          state.isLocating = false;
          state.geoError = null;
          state.showGeoModal = false;
          state.userPosition = [position.coords.latitude, position.coords.longitude];
        },
        (error: any) => {
          state.isLocating = false;
          state.userPosition = defaultCenter;
          state.geoError = error.code;
          state.showGeoModal = true;
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    };

    it('should successfully acquire position and update coordinates without opening modal', () => {
      const mockGetCurrentPosition = vi.fn((success) => {
        success({
          coords: {
            latitude: 50.1109,
            longitude: 8.6821,
          },
        });
      });

      const mockGeolocation = { getCurrentPosition: mockGetCurrentPosition };
      const state = {
        userPosition: defaultCenter,
        showGeoModal: false,
        geoError: null,
        isLocating: false,
      };

      runRequestLocation(mockGeolocation, state);

      expect(mockGetCurrentPosition).toHaveBeenCalled();
      expect(state.userPosition).toEqual([50.1109, 8.6821]);
      expect(state.showGeoModal).toBe(false);
      expect(state.geoError).toBeNull();
      expect(state.isLocating).toBe(false);
    });

    it('should catch PERMISSION_DENIED (code 1), fallback to default coords, and display error modal', () => {
      const mockGetCurrentPosition = vi.fn((_success, error) => {
        error({
          code: 1, // PERMISSION_DENIED
          message: 'User denied Geolocation',
        });
      });

      const mockGeolocation = { getCurrentPosition: mockGetCurrentPosition };
      const state = {
        userPosition: [52.52, 13.405] as [number, number],
        showGeoModal: false,
        geoError: null,
        isLocating: false,
      };

      runRequestLocation(mockGeolocation, state);

      expect(state.userPosition).toEqual(defaultCenter);
      expect(state.showGeoModal).toBe(true);
      expect(state.geoError).toBe(1);
      expect(state.isLocating).toBe(false);
    });

    it('should catch POSITION_UNAVAILABLE (code 2), fallback to default coords, and display error modal', () => {
      const mockGetCurrentPosition = vi.fn((_success, error) => {
        error({
          code: 2, // POSITION_UNAVAILABLE
          message: 'Position unavailable',
        });
      });

      const mockGeolocation = { getCurrentPosition: mockGetCurrentPosition };
      const state = {
        userPosition: [52.52, 13.405] as [number, number],
        showGeoModal: false,
        geoError: null,
        isLocating: false,
      };

      runRequestLocation(mockGeolocation, state);

      expect(state.userPosition).toEqual(defaultCenter);
      expect(state.showGeoModal).toBe(true);
      expect(state.geoError).toBe(2);
      expect(state.isLocating).toBe(false);
    });

    it('should catch TIMEOUT (code 3), fallback to default coords, and display error modal', () => {
      const mockGetCurrentPosition = vi.fn((_success, error) => {
        error({
          code: 3, // TIMEOUT
          message: 'Timeout expired',
        });
      });

      const mockGeolocation = { getCurrentPosition: mockGetCurrentPosition };
      const state = {
        userPosition: defaultCenter,
        showGeoModal: false,
        geoError: null,
        isLocating: false,
      };

      runRequestLocation(mockGeolocation, state);

      expect(state.userPosition).toEqual(defaultCenter);
      expect(state.showGeoModal).toBe(true);
      expect(state.geoError).toBe(3);
      expect(state.isLocating).toBe(false);
    });

    it('should allow retrying geolocation after an initial error', () => {
      let callCount = 0;
      const mockGetCurrentPosition = vi.fn((success, error) => {
        callCount++;
        if (callCount === 1) {
          error({ code: 3, message: 'Timeout' });
        } else {
          success({
            coords: { latitude: 49.9929, longitude: 8.2473 },
          });
        }
      });

      const mockGeolocation = { getCurrentPosition: mockGetCurrentPosition };
      const state = {
        userPosition: defaultCenter,
        showGeoModal: false,
        geoError: null,
        isLocating: false,
      };

      // First run: fails with timeout
      runRequestLocation(mockGeolocation, state);
      expect(state.showGeoModal).toBe(true);
      expect(state.geoError).toBe(3);

      // Retry run (simulates clicking data-testid="retry-geolocation-btn")
      runRequestLocation(mockGeolocation, state);
      expect(mockGetCurrentPosition).toHaveBeenCalledTimes(2);
      expect(state.showGeoModal).toBe(false);
      expect(state.geoError).toBeNull();
    });

    it('should handle undefined geolocation defensively without crashing', () => {
      const state = {
        userPosition: defaultCenter,
        showGeoModal: false,
        geoError: null,
        isLocating: false,
      };

      runRequestLocation(undefined, state);

      expect(state.showGeoModal).toBe(true);
      expect(state.geoError).toBe(2);
      expect(state.userPosition).toEqual(defaultCenter);
    });
  });
});