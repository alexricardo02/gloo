import { describe, it, expect, vi, beforeEach } from 'vitest';
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
});