import { Gender, Role } from '@prisma/client'
import { prisma } from '../lib/prisma'

// 1. Defined Groups and Users Data
const GROUPS = [
  {
    email: 'party1@test.com',
    username: 'mainz_crew',
    name: 'Mainz Party Animals',
    birthDate: new Date('2000-01-01'),
    group: {
      membersCount: 4,
      gender: Gender.MIXED,
      ageMin: 20,
      ageMax: 26,
      searchAgeMin: 18,
      searchAgeMax: 30,
      searchGender: Gender.MIXED,
      description: "We are 4 friends looking for a cool pre-party in Mainz! Bring your own drinks. Good vibes only.",
      latitude: 49.9920,
      longitude: 8.2720, // Corrected to actual Mainz longitude
      photos: [
        "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?q=80&w=1000&auto=format&fit=crop",
        "https://images.unsplash.com/photo-1566737236500-c8ac43014a67?q=80&w=1000&auto=format&fit=crop",
        "https://images.unsplash.com/photo-1574406280735-351fc1a7c5e0?q=80&w=1000&auto=format&fit=crop",
      ],
      instagram: ["mainz_party"],
      isPartyMode: true,
      publicProfile: true,
    }
  },
  {
    email: 'girlsnight@test.com',
    username: 'wiesbaden_girls',
    name: 'Girls Night Out',
    birthDate: new Date('2001-05-15'),
    group: {
      membersCount: 3,
      gender: Gender.FEMALE,
      ageMin: 21,
      ageMax: 24,
      searchAgeMin: 20,
      searchAgeMax: 28,
      searchGender: Gender.MIXED,
      description: "Wiesbaden girls ready to hit the clubs later. Looking for a fun pre-party to start the night right.",
      latitude: 50.0825,
      longitude: 8.2400,
      photos: [
        "https://images.unsplash.com/photo-1566737236500-c8ac43014a67?q=80&w=1000&auto=format&fit=crop",
        "https://images.unsplash.com/photo-1574406280735-351fc1a7c5e0?q=80&w=1000&auto=format&fit=crop",
      ],
      instagram: ["wiesbaden_girls"],
      isPartyMode: false,
      publicProfile: true,
    }
  },
  {
    email: 'techno@test.com',
    username: 'techno_bros',
    name: 'Techno Bros',
    birthDate: new Date('1998-10-20'),
    group: {
      membersCount: 5,
      gender: Gender.MALE,
      ageMin: 23,
      ageMax: 29,
      searchAgeMin: 20,
      searchAgeMax: 35,
      searchGender: Gender.MIXED,
      description: "Frankfurt massive! Heading to a techno rave later, who wants to join us for drinks before?",
      latitude: 50.1109,
      longitude: 8.6821,
      photos: [
        "https://images.unsplash.com/photo-1574406280735-351fc1a7c5e0?q=80&w=1000&auto=format&fit=crop",
        "https://images.unsplash.com/photo-1543269865-cbf427effbad?q=80&w=1000&auto=format&fit=crop",
      ],
      instagram: ["techno_bros"],
      isPartyMode: true,
      publicProfile: true,
    }
  },
  {
    email: 'chill@test.com',
    username: 'chill_vibes',
    name: 'Wine & Dine',
    birthDate: new Date('1999-03-10'),
    group: {
      membersCount: 2,
      gender: Gender.FEMALE,
      ageMin: 24,
      ageMax: 26,
      searchAgeMin: 22,
      searchAgeMax: 30,
      searchGender: Gender.FEMALE,
      description: "Having some wine in Mainz. We have a nice rooftop, looking for cool people to talk and chill.",
      latitude: 49.9950,
      longitude: 8.2750,
      photos: [
        "https://images.unsplash.com/photo-1529543544282-ea669407fca3?q=80&w=1000&auto=format&fit=crop",
      ],
      instagram: ["chill_mainz"],
      isPartyMode: false,
      publicProfile: true,
    }
  }
];

// 2. Defined Venues (Bars & Clubs)
const VENUES = [
  { name: "Schon Schon", type: "CLUB", latitude: 50.0015, longitude: 8.2587 },
  { name: "KUZ", type: "CLUB", latitude: 49.9947, longitude: 8.2787 },
  { name: "Alexander the Great", type: "BAR", latitude: 49.9984, longitude: 8.2713 },
  { name: "Irish Pub Mainz", type: "BAR", latitude: 49.9986, longitude: 8.2700 },
  { name: "Eisgrub-Brau", type: "BAR", latitude: 49.9953, longitude: 8.2709 }
];

async function main() {
  console.log('🌱 Starting database seeding...');

  // --- A. SEED USERS & GROUPS ---
  console.log('➡️  Seeding Users and Groups...');
  const createdUsers = [];
  const createdGroups = [];

  for (const data of GROUPS) {
    const user = await prisma.user.upsert({
      where: { email: data.email },
      update: {
        username: data.username,
        name: data.name,
        isVerified: true,
      },
      create: {
        email: data.email,
        username: data.username,
        name: data.name,
        // Tell Bearer SAST scanner to ignore this dummy seed password
        // bearer:disable javascript_lang_hardcoded_secret
        password: 'hashedpassword123',
        birthDate: data.birthDate,
        isGuest: false,
        isVerified: true, 
      },
    });

    const group = await prisma.group.upsert({
      where: { userId: user.id },
      update: {
        ...data.group
      },
      create: {
        userId: user.id,
        ...data.group,
      },
    });

    createdUsers.push(user);
    createdGroups.push(group);
    console.log(`  ✅ Saved User/Group: ${data.name} (${data.group.membersCount} members)`);
  }

  // --- B. SEED VENUES ---
  console.log('➡️  Seeding Venues (Bars & Clubs)...');
  for (const venue of VENUES) {
    const existingVenue = await prisma.venue.findFirst({
      where: { name: venue.name }
    });
    
    if (existingVenue) {
      await prisma.venue.update({
        where: { id: existingVenue.id },
        data: venue
      });
    } else {
      await prisma.venue.create({
        data: venue
      });
    }
    console.log(`  ✅ Saved venue: ${venue.name}`);
  }

  // --- C. SEED INTERACTIONS (LIKES) ---
  console.log('➡️  Seeding Group Likes (Matches & Feed)...');
  // Group 2 (girlsnight) likes Group 1 (party1)
  await prisma.groupLike.upsert({
    where: {
      fromGroupId_toGroupId: {
        fromGroupId: createdGroups[1].id,
        toGroupId: createdGroups[0].id,
      }
    },
    update: {},
    create: {
      fromGroupId: createdGroups[1].id,
      toGroupId: createdGroups[0].id,
    }
  });
  console.log(`  ✅ Saved Like: ${createdUsers[1].name} -> ${createdUsers[0].name}`);

  // --- D. SEED CHATS & MESSAGES ---
  console.log('➡️  Seeding Chats and Messages...');
  
  // Create a chat between party1 and girlsnight
  const chat = await prisma.chat.upsert({
    where: {
      hostAId_hostBId: {
        hostAId: createdUsers[0].id,
        hostBId: createdUsers[1].id,
      }
    },
    update: {},
    create: {
      hostAId: createdUsers[0].id,
      hostBId: createdUsers[1].id,
    }
  });

  // Populate messages if empty
  const messageCount = await prisma.message.count({ where: { chatId: chat.id } });
  if (messageCount === 0) {
    await prisma.message.createMany({
      data: [
        {
          chatId: chat.id,
          senderId: createdUsers[0].id,
          text: "Hey girls! We are already in Mainz getting drinks ready, want to join our pre-party?",
          createdAt: new Date(Date.now() - 60000 * 5) // 5 mins ago
        },
        {
          chatId: chat.id,
          senderId: createdUsers[1].id,
          text: "Hey! That sounds awesome. Send us the location, we'll be there in 30 mins!",
          createdAt: new Date(Date.now() - 60000 * 2) // 2 mins ago
        }
      ]
    });
    console.log(`  ✅ Saved Chat & Messages between ${createdUsers[0].name} and ${createdUsers[1].name}`);
  }

  console.log('🎉 Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });