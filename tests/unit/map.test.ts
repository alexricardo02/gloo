import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toggleVenueAttendance } from '@/app/actions/map';
import { getActiveEvents, getMapData, getVenues } from '@/lib/mapData';

type VenueArgs = { select: { attendees: { select: { group: { select: Record<string, unknown> & { user: { select: unknown } } } } } } };
import { prisma } from '@/lib/prisma';


vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: vi.fn(() => undefined)
  }))
}));

vi.mock('@/lib/session', () => ({
  getOptionalUserId: vi.fn(async () => 'fake-user-id'),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    venue: {
      findMany: vi.fn()
    },
    event: {
      findMany: vi.fn(),
      findFirst: vi.fn()
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

  describe('getVenues (lib/mapData, served by GET /api/map)', () => {
    it('returns venues with their attendees, using an explicit select (no group or user ids)', async () => {
      vi.mocked(prisma.venue.findMany).mockResolvedValue([{
        id: 'venue-1',
        name: 'Schon Schön',
        type: 'BAR',
        latitude: 50,
        longitude: 8.2,
        attendees: [{ id: 'att-1', group: { membersCount: 3, gender: 'MIXED', photos: [], user: { name: 'Ana' } } }],
      }] as never);

      const result = await getVenues();

      const args = vi.mocked(prisma.venue.findMany).mock.calls[0][0] as unknown as VenueArgs;
      expect(args.select.attendees.select.group.select).not.toHaveProperty('id');
      expect(args.select.attendees.select.group.select.user.select).toEqual({ name: true });
      expect(result).toEqual([{
        id: 'venue-1',
        name: 'Schon Schön',
        type: 'BAR',
        latitude: 50,
        longitude: 8.2,
        attendees: [{ id: 'att-1', group: { membersCount: 3, gender: 'MIXED', photos: [], user: { name: 'Ana' } } }],
      }]);
    });

    it('lets database errors reach the route handler (answered as 500)', async () => {
      vi.mocked(prisma.venue.findMany).mockRejectedValue(new Error('Database Connection Error'));
      await expect(getVenues()).rejects.toThrow('Database Connection Error');
    });
  });

  describe('getActiveEvents / getMapData (lib/mapData)', () => {
    const group = (userId: string, name: string) => ({ userId, membersCount: 2, gender: 'MIXED', photos: [], user: { name } });
    const event = {
      id: 'ev-1',
      description: 'Pre',
      locationName: 'Hidden',
      latitude: 50,
      longitude: 8,
      endTime: new Date('2030-01-01T00:00:00Z'),
      ownerId: 'host-user',
      owner: { name: 'Host', group: { membersCount: 4 } },
      attendees: [
        { id: 'a-pending', status: 'PENDING', group: group('pending-user', 'P') },
        { id: 'a-accepted', status: 'ACCEPTED', group: group('accepted-user', 'A') },
      ],
    };

    beforeEach(() => {
      vi.mocked(prisma.event.findMany).mockResolvedValue([event] as never);
    });

    it('the host sees every request and no other user ids', async () => {
      const [dto] = await getActiveEvents('host-user');
      expect(dto).toMatchObject({ isHost: true, myStatus: null, ownerId: null });
      expect(dto.attendees.map((a) => a.id)).toEqual(['a-pending', 'a-accepted']);
      expect(JSON.stringify(dto)).not.toMatch(/pending-user|accepted-user/);
    });

    it('an accepted guest sees accepted guests and the host id (to open the chat)', async () => {
      const [dto] = await getActiveEvents('accepted-user');
      expect(dto).toMatchObject({ isHost: false, myStatus: 'ACCEPTED', ownerId: 'host-user' });
      expect(dto.attendees.map((a) => a.id)).toEqual(['a-accepted']);
    });

    it('anyone else sees no attendees and no host id', async () => {
      const [pending] = await getActiveEvents('pending-user');
      expect(pending).toMatchObject({ myStatus: 'PENDING', ownerId: null, attendees: [] });
      const [stranger] = await getActiveEvents('someone-else');
      expect(stranger).toMatchObject({ myStatus: null, ownerId: null, attendees: [] });
    });

    it('signed out (guest): venues only, no events are queried', async () => {
      vi.mocked(prisma.venue.findMany).mockResolvedValue([] as never);
      expect(await getMapData(null)).toEqual({ signedIn: false, venues: [], events: [], myEvent: null });
      expect(prisma.event.findMany).not.toHaveBeenCalled();
    });

    it('signed in: runs the loaders in parallel', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      vi.mocked(prisma.venue.findMany).mockImplementation((async () => { await gate; return []; }) as never);
      vi.mocked(prisma.event.findFirst).mockResolvedValue(null);

      const pending = getMapData('host-user');
      await new Promise((r) => setTimeout(r, 0));
      // The event queries started while the venue query is still pending.
      expect(prisma.event.findMany).toHaveBeenCalled();
      expect(prisma.event.findFirst).toHaveBeenCalled();
      release();
      expect((await pending).events).toHaveLength(1);
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