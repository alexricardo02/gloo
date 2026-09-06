import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  registerUser, 
  loginUser, 
  getCurrentUser, 
  logOutAction, 
  checkUsernameAvailability 
} from '@/app/actions/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import crypto from 'crypto';
import { resetPassword } from "@/app/actions/auth";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn(),
        getPublicUrl: vi.fn()
      })
    }
  }
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-key";

// MOCKS
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(),
    compare: vi.fn(),
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('crypto', () => ({
  default: {
    randomUUID: vi.fn(),
  },
}));

// --- HELPERS ---
const createFormData = (data: Record<string, string>) => {
  const formData = new FormData();
  Object.entries(data).forEach(([key, value]) => formData.append(key, value));
  return formData;
};

// Calculate dynamic dates to avoid hardcoded dates expiring
const getAdultDate = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 20); // 20 years old
  return d.toISOString().split('T')[0];
};

const getMinorDate = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 15); // 15 years old
  return d.toISOString().split('T')[0];
};


describe('Auth Server Actions (Unit Tests)', () => {
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. REGISTER USER TESTS
  describe('registerUser', () => {
    it('should return an error if birthDate is missing', async () => {
      const formData = createFormData({ email: 'test@test.com', password: 'Password123!', username: 'testuser' });
      const result = await registerUser(formData, 'en');
      expect(result).toEqual({ error: 'Date of birth is required' });
    });

    it('should return an ageMinError if user is under 18', async () => {
      const formData = createFormData({ 
        email: 'test@test.com', password: 'Password123!', username: 'testuser', birthDate: getMinorDate() 
      });
      const result = await registerUser(formData, 'en');
      expect(result).toEqual({ error: 'ageMinError' });
    });

    it('should return passwordWeakError if password is not strong enough', async () => {
      const formData = createFormData({ 
        email: 'test@test.com', password: 'weak', username: 'testuser', birthDate: getAdultDate() 
      });
      const result = await registerUser(formData, 'en');
      expect(result).toEqual({ error: 'passwordWeakError' });
    });

    it('should return emailExistsError if email is already in the database', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: '1' } as any);

      const formData = createFormData({ 
        email: 'exist@test.com', password: 'ValidPassword123!', username: 'testuser', birthDate: getAdultDate() 
      });
      
      const result = await registerUser(formData, 'en');
      expect(result).toEqual({ error: 'emailExistsError' });
    });

    it('should return usernameTakenError if username is already in the database', async () => {
      // First call: email check (returns null -> available)
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      // Second call: username check (returns user -> taken)
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: '2' } as any);

      const formData = createFormData({ 
        email: 'new@test.com', password: 'ValidPassword123!', username: 'taken_user', birthDate: getAdultDate() 
      });
      
      const result = await registerUser(formData, 'en');
      expect(result).toEqual({ error: 'usernameTakenError' });
    });

    it('should successfully create an unverified user and return success', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed_password' as never);

      const formData = createFormData({ 
        email: 'new@test.com', password: 'ValidPassword123!', username: 'newuser', name: 'John Doe', birthDate: getAdultDate() 
      });

      const result = await registerUser(formData, 'en');

      // Verify Prisma create was called with correct data
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'new@test.com',
          username: 'newuser',
          name: 'John Doe',
          password: 'hashed_password',
          isVerified: false,
          birthDate: expect.any(Date),
          verificationToken: expect.any(String),
        })
      });

      expect(result).toEqual({ success: true, needsVerification: true });
    });

    it('should catch critical errors and return registrationGenericError', async () => {
      vi.mocked(prisma.user.findUnique).mockRejectedValueOnce(new Error('DB Down'));

      const formData = createFormData({ 
        email: 'new@test.com', password: 'ValidPassword123!', username: 'newuser', birthDate: getAdultDate() 
      });

      const result = await registerUser(formData, 'en');
      expect(result).toEqual({ error: 'registrationGenericError' });
    });
  });

  // 2. LOGIN USER TESTS

  describe('loginUser', () => {
    it('should return an error if credentials are missing', async () => {
      const formData = createFormData({});
      const result = await loginUser(formData, 'en');
      expect(result).toEqual({ error: 'invalidCredentialsError' });
    });

    it('should return invalidCredentialsError if user is not found', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
      
      const formData = createFormData({ identifier: 'wrong@user.com', password: 'pw' });
      const result = await loginUser(formData, 'en');
      
      expect(result).toEqual({ error: 'invalidCredentialsError' });
    });

    it('should return invalidCredentialsError if password does not match', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ password: 'hashed_pw' } as any);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
      
      const formData = createFormData({ identifier: 'user@test.com', password: 'wrongpw' });
      const result = await loginUser(formData, 'en');
      
      expect(result).toEqual({ error: 'invalidCredentialsError' });
    });

    it('should return emailNotVerifiedError if user account is not activated', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ password: 'hashed_pw', isVerified: false } as any);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      
      const formData = createFormData({ identifier: 'user@test.com', password: 'correctpw' });
      const result = await loginUser(formData, 'en');
      
      expect(result).toEqual({ error: 'emailNotVerifiedError' });
    });

    it('should set cookies and redirect upon successful login', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'user-123', password: 'hashed_pw', isVerified: true } as any);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      
      const mockSet = vi.fn();
      const mockDelete = vi.fn();
      vi.mocked(cookies).mockResolvedValue({ set: mockSet, delete: mockDelete } as any);

      const formData = createFormData({ identifier: 'user@test.com', password: 'correctpw' });
      await loginUser(formData, 'en');

      expect(mockSet).toHaveBeenCalledWith('gloo_user_id', 'user-123', expect.any(Object));
      expect(mockDelete).toHaveBeenCalledWith('gloo_is_guest');
      expect(redirect).toHaveBeenCalledWith('/en/search-groups');
    });
  });

  // 3. GET CURRENT USER TESTS

  describe('getCurrentUser', () => {
    it('should return null if gloo_user_id cookie is missing', async () => {
      vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) } as any);
      const user = await getCurrentUser();
      expect(user).toBeNull();
    });

    it('should return user object if cookie exists', async () => {
      vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'user-123' }) } as any);
      const mockUser = { name: 'John', username: 'johndoe', image: 'avatar.png' };
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);

      const user = await getCurrentUser();
      
      expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-123' } }));
      expect(user).toEqual(mockUser);
    });
  });

  // 4. LOGOUT TESTS

  describe('logOutAction', () => {
    it('should clear user session, set guest cookies and redirect', async () => {
      const mockSet = vi.fn();
      const mockDelete = vi.fn();
      vi.mocked(cookies).mockResolvedValue({ set: mockSet, delete: mockDelete } as any);

      await logOutAction('en');

      expect(mockDelete).toHaveBeenCalledWith('gloo_user_id');
      expect(mockSet).toHaveBeenCalledWith('gloo_is_guest', 'true', expect.any(Object));
      expect(mockSet).toHaveBeenCalledWith('gloo_guest_id', expect.any(String), expect.any(Object));
      expect(redirect).toHaveBeenCalledWith('/en/search-groups');
    });
  });

  // 5. REAL-TIME VALIDATION TESTS

  describe('checkUsernameAvailability', () => {
    it('should instantly return false if username is less than 3 characters', async () => {
      const result = await checkUsernameAvailability('ab');
      expect(result).toEqual({ available: false });
      expect(prisma.user.findUnique).not.toHaveBeenCalled(); // Ensures DB is not queried
    });

    it('should return available: false if username exists', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'existing-user' } as any);
      const result = await checkUsernameAvailability('takenUser');
      expect(result).toEqual({ available: false });
    });

    it('should return available: true if username does not exist', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      const result = await checkUsernameAvailability('freeUser');
      expect(result).toEqual({ available: true });
    });

    it('should catch exceptions and return available: false for safety', async () => {
      vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('Network error'));
      const result = await checkUsernameAvailability('errorUser');
      expect(result).toEqual({ available: false });
    });
  });

  describe("Security Boundaries: Password Reset", () => {
  it("should reject a password reset if the token has expired", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);

    const result = await resetPassword("expired-token", "NewSecurePass123!");
    
    // Based on standard security requirements, this MUST fail
    expect(result.error).toBe("tokenInvalidOrExpired");
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("should reject a password reset if no valid token is provided", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);

    const result = await resetPassword("fake-token", "NewSecurePass123!");
    
    expect(result.error).toBe("tokenInvalidOrExpired");
  });

  it('should reject registration if the email already exists in the database (TC5)', async () => {
      // Simulate that Prisma finds a user when checking if email exists
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "existing-id",
        email: "alreadyused@example.com",
        username: "someone_else"
      } as any);

      const formData = new FormData();
      formData.append('email', 'alreadyused@example.com');
      formData.append('password', 'SecurePass123!');
      formData.append('username', 'new_user');
      formData.append('name', 'New Name');
      formData.append('birthDate', '2000-01-01');

      const result = await registerUser(formData, 'en');

      // Verifies exact security rule implementation
      expect(result.error).toBe("emailExistsError");
      // Ensures no creation attempt was made to the DB
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
});

});