const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

let db;
function getDB() {
  if (!db) {
    let app;
    if (getApps().length === 0) {
      app = initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/^"|"$/g, '').replace(/\\n/g, '\n')
        })
      });
    } else {
      app = getApps()[0];
    }
    db = getFirestore(app);
  }
  return db;
}

// Thread-safe auto-incrementing ID generator using transactions
async function getNextId(collectionName) {
  const firestore = getDB();
  const counterRef = firestore.collection('counters').doc(collectionName);
  let nextId;
  await firestore.runTransaction(async (transaction) => {
    const doc = await transaction.get(counterRef);
    if (!doc.exists) {
      nextId = 1;
      transaction.set(counterRef, { current: 1 });
    } else {
      nextId = doc.data().current + 1;
      transaction.update(counterRef, { current: nextId });
    }
  });
  return nextId;
}

// Ecosystem mapping based on email domain
function getEcosystem(email) {
  if (!email) return 'rishihood';
  const domain = email.toLowerCase().trim().split('@')[1] || '';
  
  if (domain.includes('vitbhopal')) {
    return 'vitbhopal';
  } else if (domain.includes('rishihood')) {
    return 'rishihood';
  } else if (domain.includes('amity')) {
    return 'amity';
  } else if (domain.includes('cuchd') || domain.includes('cumail') || domain.includes('chandigarh')) {
    return 'chandigarh';
  }
  
  // Extract organization name from domain (e.g. lpu.in -> lpu, du.ac.in -> du)
  const parts = domain.split('.');
  if (parts.length >= 2) {
    const org = parts[parts.length - 2];
    if (org && !['gmail', 'yahoo', 'outlook', 'hotmail', 'icloud'].includes(org)) {
      return org;
    }
  }
  
  return 'rishihood';
}

// Seed demo users. The "already seeded" flag lives in Firestore (meta/seed)
// rather than a local file, so multiple server instances / ephemeral deploys
// all see the same flag and never double-seed.
async function seedDemoUsers() {
  if (process.env.NODE_ENV === 'production') {
    // Demo accounts are never seeded in production; record the flag so this
    // check is a single Firestore read on every boot.
    console.log('Skipping demo user seeding in production.');
    await getDB().collection('meta').doc('seed').set({ done: true, at: new Date().toISOString() }).catch(() => {});
    return;
  }

  const firestore = getDB();
  const seedMeta = await firestore.collection('meta').doc('seed').get().catch(() => null);
  if (seedMeta && seedMeta.exists && seedMeta.data().done) return;

  const usersColl = firestore.collection('users');
  const snapshot = await usersColl.limit(1).get();

  if (!snapshot.empty) {
    console.log('Database already seeded or users exist.');
    // Record the flag so we never re-scan the users collection again
    await firestore.collection('meta').doc('seed').set({ done: true, at: new Date().toISOString() }).catch(() => {});
    return;
  }

  const defaultHash = bcrypt.hashSync('123456', 10);
  const demos = [
    // Rishihood Ecosystem
    { id: 1, username: 'wanderlust_amy', gender: 'female', bio: 'Dog mom, amateur pasta maker, and weekend hiker. Love finding obscure coffee shops.', hobbies: ['hiking', 'photography', 'coffee', 'cooking', 'travel'], avatar: 'female_01', ecosystem: 'rishihood', email: 'wanderlust_amy@nst.rishihood.edu.in' },
    { id: 2, username: 'art_vibes', gender: 'female', bio: 'Art enthusiast and gallery hopper. Always on the lookout for the next great exhibition.', hobbies: ['art', 'photography', 'reading', 'music'], avatar: 'female_02', ecosystem: 'rishihood', email: 'art_vibes@nst.rishihood.edu.in' },
    { id: 3, username: 'stellar_jay', gender: 'male', bio: 'Astronomy nerd and weekend astronomer. Love stargazing and deep conversations.', hobbies: ['photography', 'hiking', 'reading', 'movies', 'camping'], avatar: 'male_01', ecosystem: 'rishihood', email: 'stellar_jay@nst.rishihood.edu.in' },
    { id: 4, username: 'coffee_leo', gender: 'male', bio: 'Barista by day, musician by night. Looking for someone to share a latte and a laugh.', hobbies: ['coffee', 'music', 'cooking', 'baking', 'writing'], avatar: 'male_02', ecosystem: 'rishihood', email: 'coffee_leo@nst.rishihood.edu.in' },
    { id: 5, username: 'trailblazer', gender: 'female', bio: "Trail runner and outdoor enthusiast. Summited 12 peaks last year! Let's explore together.", hobbies: ['hiking', 'running', 'yoga', 'travel', 'camping'], avatar: 'female_03', ecosystem: 'rishihood', email: 'trailblazer@nst.rishihood.edu.in' },
    { id: 6, username: 'pixel_wanderer', gender: 'male', bio: 'Digital nomad and travel photographer. Capturing moments one frame at a time.', hobbies: ['photography', 'travel', 'hiking', 'coffee', 'writing'], avatar: 'male_03', ecosystem: 'rishihood', email: 'pixel_wanderer@nst.rishihood.edu.in' },
    { id: 7, username: 'bookish_bee', gender: 'female', bio: 'Bookworm with an indie soul. Bibliophile, poet, and curator of cozy corners.', hobbies: ['reading', 'writing', 'coffee', 'music', 'gardening'], avatar: 'female_04', ecosystem: 'rishihood', email: 'bookish_bee@nst.rishihood.edu.in' },
    { id: 8, username: 'green_mind', gender: 'male', bio: 'Plant dad and sustainability advocate. Growing my own food and building a better world.', hobbies: ['gardening', 'cooking', 'yoga', 'reading', 'cycling'], avatar: 'male_04', ecosystem: 'rishihood', email: 'green_mind@nst.rishihood.edu.in' },
    { id: 9, username: 'melody_maker', gender: 'female', bio: 'Indie musician and vinyl collector. Music is my love language.', hobbies: ['music', 'writing', 'art', 'coffee', 'dancing'], avatar: 'female_05', ecosystem: 'rishihood', email: 'melody_maker@nst.rishihood.edu.in' },
    { id: 10, username: 'ocean_soul', gender: 'male', bio: 'Surfer, sailor, and beach bum. The ocean is my happy place.', hobbies: ['swimming', 'travel', 'photography', 'yoga', 'running'], avatar: 'male_05', ecosystem: 'rishihood', email: 'ocean_soul@nst.rishihood.edu.in' },
    { id: 11, username: 'spice_queen', gender: 'female', bio: 'Home chef and spice collector. Cooking my way around the world from my tiny kitchen.', hobbies: ['cooking', 'travel', 'baking', 'gardening', 'dancing'], avatar: 'female_06', ecosystem: 'rishihood', email: 'spice_queen@nst.rishihood.edu.in' },
    { id: 12, username: 'zen_master', gender: 'male', bio: 'Yoga instructor and mindfulness coach. Finding balance in a chaotic world.', hobbies: ['yoga', 'meditation', 'hiking', 'reading', 'gardening'], avatar: 'male_06', ecosystem: 'rishihood', email: 'zen_master@nst.rishihood.edu.in' },
    
    // VIT Bhopal Ecosystem
    { id: 13, username: 'vit_lily', gender: 'female', bio: 'Tech enthusiast, coder, and late-night gamer. Always up for a hackathon or a movie night.', hobbies: ['gaming', 'music', 'travel', 'coffee'], avatar: 'female_01', ecosystem: 'vitbhopal', email: 'vit_lily@vitbhopal.ac.in' },
    { id: 14, username: 'vit_alex', gender: 'male', bio: 'Photography enthusiast, nature lover, and street food hunter. Capturing the moments that matter.', hobbies: ['photography', 'hiking', 'travel', 'cooking'], avatar: 'male_01', ecosystem: 'vitbhopal', email: 'vit_alex@vitbhopal.ac.in' },
    { id: 15, username: 'vit_sara', gender: 'female', bio: 'Book lover, poet, and classical dancer. Seeking interesting conversations over tea.', hobbies: ['reading', 'writing', 'dancing', 'art'], avatar: 'female_02', ecosystem: 'vitbhopal', email: 'vit_sara@vitbhopal.ac.in' },
    { id: 16, username: 'vit_ryan', gender: 'male', bio: 'Fitness junkie, runner, and amateur guitarist. Striving to stay active and creative every day.', hobbies: ['running', 'music', 'yoga', 'cycling'], avatar: 'male_02', ecosystem: 'vitbhopal', email: 'vit_ryan@vitbhopal.ac.in' }
  ];

  const batch = firestore.batch();
  for (const u of demos) {
    const docRef = usersColl.doc(String(u.id));
    batch.set(docRef, {
      ...u,
      username_lower: normalizeUsername(u.username),
      passcode_hash: defaultHash,
      is_onboarded: 1,
      created_at: new Date().toISOString()
    });
  }

  // Set counter document
  const counterRef = firestore.collection('counters').doc('users');
  batch.set(counterRef, { current: 16 });

  await batch.commit();
  await firestore.collection('meta').doc('seed').set({ done: true, at: new Date().toISOString() }).catch(() => {});
  console.log(`Seeded ${demos.length} demo users in Firestore`);
}

// Removed: backfillDemoAvatars was an empty no-op kept for compatibility. No longer needed.

// In-memory cache for user lookups to reduce Firestore reads
const userByIdCache = new Map();
const USER_CACHE_TTL = 10 * 60 * 1000; // 10 minutes (profile edits invalidate cache explicitly)

function getCachedUserById(id) {
  const cached = userByIdCache.get(id);
  if (cached && Date.now() - cached.timestamp < USER_CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function setCachedUserById(id, userData) {
  userByIdCache.set(id, { data: userData, timestamp: Date.now() });
  if (userByIdCache.size > 500) {
    const oldest = userByIdCache.keys().next().value;
    if (oldest) userByIdCache.delete(oldest);
  }
}

function invalidateUserCache(id) {
  userByIdCache.delete(id);
}

// Ecosystem candidates cache (reduces Firestore reads on /api/discover)
const ecosystemCandidatesCache = new Map();
const ECOSYSTEM_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getEcosystemCandidatesCacheKey(ecosystem, genderFilter) {
  return `${ecosystem}:${genderFilter || 'all'}`;
}

function invalidateEcosystemCache(ecosystem) {
  // Invalidate all cache entries for this ecosystem (both gender-filtered and unfiltered)
  for (const [key] of ecosystemCandidatesCache) {
    if (key.startsWith(`${ecosystem}:`)) {
      ecosystemCandidatesCache.delete(key);
    }
  }
}

// Normalized form of a username used for case-insensitive uniqueness lookups.
// Stored as users/{id}.username_lower and queried directly (single-field
// equality is auto-indexed in Firestore, so this never requires a scan).
function normalizeUsername(username) {
  return String(username == null ? '' : username).trim().toLowerCase();
}

// User operations
const userOps = {
  async create(username, gender, passcodeHash, bio, hobbies, avatar) {
    const userId = await getNextId('users');
    const userDocRef = getDB().collection('users').doc(String(userId));
    await userDocRef.set({
      id: userId,
      username,
      username_lower: normalizeUsername(username),
      gender,
      passcode_hash: passcodeHash,
      bio: bio || '',
      hobbies: hobbies || [],
      avatar: avatar || '',
      is_onboarded: 0,
      email: null,
      ecosystem: 'rishihood', // Default fallback
      token_version: 0,
      created_at: new Date().toISOString()
    });
    return userId;
  },

  // Creates the user and atomically reserves its username in the `usernames`
  // collection inside ONE Firestore transaction. Two concurrent signups can
  // never both claim the same name, and the auto-increment counter is bumped
  // in the same transaction (no cross-transaction counter race).
  async createWithEmail(username, gender, email, passwordHash, bio, hobbies, avatar, publicKey = null, encryptedPrivateKey = null) {
    const firestore = getDB();
    const ecosystem = getEcosystem(email);
    const lower = normalizeUsername(username);
    let userId = null;

    await firestore.runTransaction(async (tx) => {
      const counterRef = firestore.collection('counters').doc('users');
      const counterDoc = await tx.get(counterRef);
      const next = counterDoc.exists ? (Number(counterDoc.data().current) || 0) + 1 : 1;

      const nameRef = firestore.collection('usernames').doc(lower);
      const nameDoc = await tx.get(nameRef);
      if (nameDoc.exists) {
        const conflict = new Error('Username already taken');
        conflict.code = 'username_taken';
        throw conflict;
      }

      tx.set(counterRef, { current: next });
      tx.set(nameRef, { user_id: next, created_at: new Date().toISOString() });
      tx.set(firestore.collection('users').doc(String(next)), {
        id: next,
        username,
        username_lower: lower,
        gender,
        email,
        passcode_hash: passwordHash,
        bio: bio || '',
        hobbies: hobbies || [],
        avatar: avatar || '',
        is_onboarded: 1,
        ecosystem,
        public_key: publicKey || null,
        encrypted_private_key: encryptedPrivateKey || null,
        token_version: 0,
        created_at: new Date().toISOString()
      });
      userId = next;
    });

    invalidateEcosystemCache(ecosystem);
    return userId;
  },

  // Atomic username change: swaps the reservation doc and updates the user in
  // one transaction so two concurrent renames can never both succeed, and a
  // rename can never leave a stale reservation behind.
  async changeUsernameAtomic(userId, newUsername) {
    const firestore = getDB();
    const lower = normalizeUsername(newUsername);
    const oldUser = await this.getById(userId);
    if (!oldUser) {
      const err = new Error('User not found');
      err.code = 'user_not_found';
      throw err;
    }
    const oldLower = oldUser.username ? normalizeUsername(oldUser.username) : null;
    try {
      await firestore.runTransaction(async (tx) => {
        if (oldLower && oldLower !== lower) {
          tx.delete(firestore.collection('usernames').doc(oldLower));
        }
        const nameRef = firestore.collection('usernames').doc(lower);
        const nameDoc = await tx.get(nameRef);
        if (nameDoc.exists && Number(nameDoc.data().user_id) !== Number(userId)) {
          const conflict = new Error('Username already taken');
          conflict.code = 'username_taken';
          throw conflict;
        }
        tx.set(nameRef, { user_id: Number(userId), created_at: new Date().toISOString() });
        tx.update(firestore.collection('users').doc(String(userId)), {
          username: newUsername,
          username_lower: lower,
          username_changed_at: new Date().toISOString()
        });
      });
    } catch (err) {
      if (err.code === 'username_taken' || err.code === 'user_not_found') throw err;
      // A transaction abort (e.g. a concurrent rename) is indistinguishable from
      // a conflict — surface it as a retryable "taken" error.
      const conflict = new Error('Username already taken');
      conflict.code = 'username_taken';
      throw conflict;
    }
    invalidateUserCache(userId);
    if (oldUser.ecosystem) invalidateEcosystemCache(oldUser.ecosystem);
    return true;
  },

  async getById(id) {
    if (!id) return null;
    // Check in-memory cache first
    const cached = getCachedUserById(id);
    if (cached) return cached;
    
    const doc = await getDB().collection('users').doc(String(id)).get();
    if (!doc.exists) return null;
    const userData = doc.data();
    const docId = doc.id ? (isNaN(doc.id) ? doc.id : Number(doc.id)) : null;
    const resolvedUser = { ...userData, id: userData.id || docId };
    setCachedUserById(id, resolvedUser);
    return resolvedUser;
  },
  
  async getByUsername(username) {
    if (!username) return null;
    const target = String(username).trim();
    const lower = target.toLowerCase();
    const firestore = getDB();

    // Fast path: normalized query (single-field equality, auto-indexed). New and
    // updated accounts carry `username_lower`, making this O(1) — no scan.
    try {
      const snap = await firestore.collection('users').where('username_lower', '==', lower).limit(1).get();
      if (!snap.empty) {
        const doc = snap.docs[0];
        const data = doc.data();
        const docId = doc.id ? (isNaN(doc.id) ? doc.id : Number(doc.id)) : null;
        return { ...data, id: data.id || docId };
      }
    } catch (e) {
      // Querying a field that exists on no document returns empty (not an
      // error); fall through to the legacy paths on anything unexpected.
    }

    // Legacy path: exact (case-sensitive) match — pre-normalization accounts.
    const snap = await firestore.collection('users').where('username', '==', target).limit(1).get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      const data = doc.data();
      const docId = doc.id ? (isNaN(doc.id) ? doc.id : Number(doc.id)) : null;
      // Lazy backfill so future lookups take the fast path.
      if (!data.username_lower) doc.ref.update({ username_lower: lower }).catch(() => {});
      return { ...data, id: data.id || docId };
    }

    // Legacy fallback: case-insensitive scan so "Bob" vs "bob" can never
    // collide and login with a different casing still works. Only reachable for
    // accounts created before username_lower existed; the backfill above and new
    // signups retire this path over time.
    const all = await firestore.collection('users').get();
    for (const doc of all.docs) {
      const data = doc.data();
      if (String(data.username || '').trim().toLowerCase() === lower) {
        const docId = doc.id ? (isNaN(doc.id) ? doc.id : Number(doc.id)) : null;
        if (!data.username_lower) doc.ref.update({ username_lower: lower }).catch(() => {});
        return { ...data, id: data.id || docId };
      }
    }
    return null;
  },

  async isUsernameTaken(username, excludeUserId = null) {
    const existing = await this.getByUsername(username);
    if (!existing) return false;
    if (excludeUserId !== null && excludeUserId !== undefined && String(existing.id) === String(excludeUserId)) return false;
    return true;
  },

  async updatePassword(userId, passwordHash) {
    await this.update(userId, { passcode_hash: passwordHash });
  },

  async changeUsername(userId, username) {
    await this.update(userId, {
      username: String(username).trim(),
      username_changed_at: new Date().toISOString()
    });
  },

  async getByEmail(email) {
    if (!email) return null;
    const snap = await getDB().collection('users').where('email', '==', String(email).toLowerCase().trim()).limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    const data = doc.data();
    const docId = doc.id ? (isNaN(doc.id) ? doc.id : Number(doc.id)) : null;
    return { ...data, id: data.id || docId };
  },

  async linkEmailToUser(userId, email) {
    await getDB().collection('users').doc(String(userId)).update({
      email: email,
      is_onboarded: 1
    });
  },

  // Revoke every outstanding auth token for this user by bumping token_version.
  // Bearer tokens are signed with the version at issuance, so any older token
  // fails verification immediately after this runs.
  async bumpTokenVersion(userId) {
    const user = await this.getById(userId);
    if (!user) return;
    await this.update(userId, { token_version: (user.token_version || 0) + 1 });
  },

  async update(id, fields) {
    const updatePayload = {};
    const allowed = ['bio', 'hobbies', 'avatar', 'fcm_tokens', 'username', 'username_lower', 'username_changed_at', 'passcode_hash', 'encrypted_private_key', 'public_key', 'token_version', 'totp_secret', 'totp_enabled', 'totp_backup_codes'];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        updatePayload[key] = fields[key];
      }
    }
    // Keep the normalized lookup field in sync whenever the display username changes.
    if (fields.username !== undefined && fields.username_lower === undefined) {
      updatePayload.username_lower = normalizeUsername(fields.username);
    }
    if (Object.keys(updatePayload).length === 0) return;
    const oldUser = await this.getById(id);
    await getDB().collection('users').doc(String(id)).update(updatePayload);
    // Invalidate cache on update
    invalidateUserCache(id);
    if (oldUser && oldUser.ecosystem) {
      invalidateEcosystemCache(oldUser.ecosystem);
    }
  },

  // Get discoverable profiles (filtered by ecosystem)
  async getDiscoverable(userId, genderFilter = null, excludeIds = []) {
    const firestore = getDB();
    const userDoc = await this.getById(userId);
    const userEcosystem = userDoc?.ecosystem || 'rishihood';
    
    // Fetch blocked users involving this user safely
    const blockedIds = [];
    try {
      const numId = Number(userId);
      const [blockedFrom, blockedTo] = await Promise.all([
        firestore.collection('blocked_users').where('from_user_id', '==', numId).get(),
        firestore.collection('blocked_users').where('to_user_id', '==', numId).get()
      ]);
      blockedFrom.forEach(doc => blockedIds.push(doc.data().to_user_id));
      blockedTo.forEach(doc => blockedIds.push(doc.data().from_user_id));
    } catch (bErr) {
      console.warn('Blocked users fetch error in discover:', bErr.message);
    }
    
    const allExclude = [...new Set([...excludeIds, ...blockedIds, Number(userId)])];
    
    // Check ecosystem candidates fragment cache to eliminate duplicate database query load
    const cacheKey = getEcosystemCandidatesCacheKey(userEcosystem, genderFilter);
    const cachedEntry = ecosystemCandidatesCache.get(cacheKey);
    let allEcosystemUsers = null;

    if (cachedEntry && (Date.now() - cachedEntry.timestamp < ECOSYSTEM_CACHE_TTL)) {
      allEcosystemUsers = cachedEntry.data.map(u => ({ ...u }));
    } else {
      let snapshotDocs = [];
      try {
        // Required composite index: ecosystem + gender (see firestore.indexes.json).
        let query = firestore.collection('users').where('ecosystem', '==', userEcosystem);
        if (genderFilter) {
          query = query.where('gender', '==', genderFilter);
        }
        const snap = await query.get();
        snap.forEach(d => snapshotDocs.push(d));
      } catch (indexErr) {
        // Fallback to a single-field ecosystem query (auto-indexed, always
        // available) and filter gender in memory. The composite index is a
        // deploy requirement — see firestore.indexes.json — and is never
        // silently replaced by a full collection scan, which would burn
        // Firestore read quota on a hot public endpoint.
        console.warn('Firestore discover composite index missing — using ecosystem-only query (deploy firestore.indexes.json).');
        try {
          const ecoQuery = firestore.collection('users').where('ecosystem', '==', userEcosystem);
          const ecoSnap = await ecoQuery.get();
          ecoSnap.forEach(doc => {
            const u = doc.data();
            if (!genderFilter || u.gender === genderFilter) {
              snapshotDocs.push(doc);
            }
          });
        } catch (ecoErr) {
          console.error('Firestore discover query failed:', ecoErr);
        }
      }

      allEcosystemUsers = [];
      snapshotDocs.forEach(doc => {
        const u = typeof doc.data === 'function' ? doc.data() : doc;
        const docId = doc.id ? (isNaN(doc.id) ? doc.id : Number(doc.id)) : null;
        const uid = (u && u.id !== undefined && u.id !== null) ? Number(u.id) : docId;
        if (uid) {
          allEcosystemUsers.push({
            id: uid,
            username: u.username || 'Student',
            bio: u.bio || '',
            hobbies: u.hobbies || [],
            avatar: u.avatar || null,
            gender: u.gender || 'other',
            ecosystem: u.ecosystem || 'rishihood'
          });
        }
      });

      ecosystemCandidatesCache.set(cacheKey, { data: allEcosystemUsers, timestamp: Date.now() });
    }

    // Dynamic Hole Hydration: Apply user-specific exclusions per viewer
    const discoverable = allEcosystemUsers.filter(u => !allExclude.includes(u.id));

    // Smart Hobby Compatibility & Fairness Prioritization Algorithm
    const currentUserHobbies = Array.isArray(userDoc?.hobbies)
      ? userDoc.hobbies.map(h => String(h).toLowerCase().trim())
      : String(userDoc?.hobbies || '').toLowerCase().split(',').map(h => h.trim()).filter(Boolean);

    discoverable.forEach(profile => {
      let score = 0;
      const profileHobbies = Array.isArray(profile.hobbies)
        ? profile.hobbies.map(h => String(h).toLowerCase().trim())
        : String(profile.hobbies || '').toLowerCase().split(',').map(h => h.trim()).filter(Boolean);

      // 1. Shared Hobbies Matching (+10 pts per matching hobby)
      if (currentUserHobbies.length > 0 && profileHobbies.length > 0) {
        const matches = profileHobbies.filter(h => currentUserHobbies.includes(h));
        score += matches.length * 10;
        profile.sharedHobbies = matches;
      }

      // 2. Bio completeness (+5 pts)
      if (profile.bio && profile.bio.trim().length > 10) {
        score += 5;
      }

      // 3. Completeness & Priority Score
      profile.compatibilityScore = Math.round(score);
    });

    // Stable deterministic sort: compatibility score descending, then user ID ascending as tie-breaker
    const sorted = discoverable.sort((a, b) => {
      const diff = (b.compatibilityScore || 0) - (a.compatibilityScore || 0);
      if (diff !== 0) return diff;
      return a.id - b.id;
    });
    return { profiles: sorted };
  }
};

// ─── Connection read-reduction cache ──────────────────────────────────────────
// This is a SHORT-LIVED in-memory cache (TTL 2 minutes) placed in front of
// connectionOps.getConnection(). Its sole purpose is to reduce Firestore reads
// on hot chat routes where the same connection doc is fetched for every message
// API call (auth check, send, react, upload-voice, etc.).
//
// Every connection write in this module must use updateConnection() so a cached
// connection can never outlive a successful mutation.
// ───────────────────────────────────────────────────────────────────────────────
const CONNECTION_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const CONNECTION_CACHE_MAX    = 10_000;          // hard cap — evict oldest when exceeded

/** @type {Map<string, { data: object, ts: number }>} */
const _connCache = new Map();

/**
 * Reverse index: connectionId → Set of cache keys ("connId:userId").
 * Allows O(1) eviction by connectionId instead of scanning all keys.
 * @type {Map<string|number, Set<string>>}
 */
const _connCacheIndex = new Map();

function _indexCacheKey(connectionId, cacheKey) {
  const s = _connCacheIndex.get(connectionId) || new Set();
  s.add(cacheKey);
  _connCacheIndex.set(connectionId, s);
}

function _unindexCacheKey(connectionId, cacheKey) {
  const s = _connCacheIndex.get(connectionId);
  if (!s) return;
  s.delete(cacheKey);
  if (s.size === 0) _connCacheIndex.delete(connectionId);
}

/**
 * Evict all cache entries for a given connectionId in O(1).
 * Called only by the connection-mutation helpers after a successful write.
 */
function evictConnection(connectionId) {
  const keys = _connCacheIndex.get(connectionId);
  if (!keys) return;
  for (const key of keys) {
    _connCache.delete(key);
  }
  _connCacheIndex.delete(connectionId);
}

/**
 * Executes one or more Firestore mutations for a connection, then evicts every
 * cached view only after the write/transaction has committed successfully.
 *
 * Do not call a connection document's update/set/delete methods directly.
 */
async function updateConnection(connectionId, mutation) {
  const result = await mutation();
  evictConnection(connectionId);
  return result;
}

/** Same guarantee as updateConnection() for a committed Firestore batch. */
async function updateConnections(connectionIds, mutation) {
  const result = await mutation();
  for (const connectionId of connectionIds) evictConnection(connectionId);
  return result;
}

const CONNECTION_END_REASONS = Object.freeze({
  NOT_VIBING: 'not_vibing',
  FACE_REVEAL_DECLINED: 'face_reveal_declined',
  FACE_REVEAL_TIMEOUT: 'face_reveal_timeout',
  BLOCKED: 'blocked',
  REQUEST_TIMEOUT: 'timeout'
});

const LAST_MESSAGE_CACHE_TTL_MS = 15 * 1000;
const LAST_MESSAGE_CACHE_MAX = 10_000;
const _lastMessageCache = new Map();

function getCachedLastMessage(connectionId) {
  const key = String(connectionId);
  const cached = _lastMessageCache.get(key);
  if (!cached || Date.now() - cached.ts >= LAST_MESSAGE_CACHE_TTL_MS) {
    _lastMessageCache.delete(key);
    return undefined;
  }
  return cached.data;
}

function setCachedLastMessage(connectionId, message) {
  const key = String(connectionId);
  if (_lastMessageCache.size >= LAST_MESSAGE_CACHE_MAX && !_lastMessageCache.has(key)) {
    const oldest = _lastMessageCache.keys().next().value;
    if (oldest) _lastMessageCache.delete(oldest);
  }
  _lastMessageCache.delete(key);
  _lastMessageCache.set(key, { data: message || null, ts: Date.now() });
}

function evictLastMessage(connectionId) {
  _lastMessageCache.delete(String(connectionId));
}

async function getLastMessageForConnection(connectionId) {
  const cached = getCachedLastMessage(connectionId);
  if (cached !== undefined) return cached;

  const { data: lastMsgs, error } = await getSupabase()
    .from('messages')
    .select('*')
    .eq('connection_id', Number(connectionId))
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  const lastMsg = lastMsgs && lastMsgs.length > 0 ? lastMsgs[0] : null;
  setCachedLastMessage(connectionId, lastMsg);
  return lastMsg;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// Connection operations
const ACTIVE_CONNECTION_STATUSES = ['accepted', 'revealed'];

function activeConnectionLockRef(userId) {
  return getDB().collection('active_connection_locks').doc(String(userId));
}

async function releaseActiveConnectionLocks(transaction, connection) {
  const lockRefs = [
    activeConnectionLockRef(connection.from_user_id),
    activeConnectionLockRef(connection.to_user_id)
  ];
  const lockDocs = await Promise.all(lockRefs.map(ref => transaction.get(ref)));
  lockDocs.forEach((lockDoc, index) => {
    if (lockDoc.exists && Number(lockDoc.data().connection_id) === Number(connection.id)) {
      transaction.delete(lockRefs[index]);
    }
  });
}

const connectionOps = {
  isActive(connection) {
    return !!connection && ACTIVE_CONNECTION_STATUSES.includes(connection.status);
  },

  async sendRequest(fromId, toId) {
    const firestore = getDB();

    const [blocked1, blocked2] = await Promise.all([
      blockOps.isBlocked(fromId, toId),
      blockOps.isBlocked(toId, fromId)
    ]);
    if (blocked1 || blocked2) {
      return { error: 'You cannot connect with this student.' };
    }
    
    // Check if connection already exists in parallel
    const [snap1, snap2] = await Promise.all([
      firestore.collection('connections')
        .where('from_user_id', '==', Number(fromId))
        .where('to_user_id', '==', Number(toId))
        .limit(1).get(),
      firestore.collection('connections')
        .where('from_user_id', '==', Number(toId))
        .where('to_user_id', '==', Number(fromId))
        .limit(1).get()
    ]);
      
    const doc = !snap1.empty ? snap1.docs[0].data() : (!snap2.empty ? snap2.docs[0].data() : null);
    if (doc) {
      // Allow reconnection if the previous connection was ended/rejected/expired.
      // This ensures users can send a new request after a chat ends ("Not Vibing").
      if (doc.status === 'rejected' || doc.status === 'expired') {
        const docRef = !snap1.empty ? snap1.docs[0].ref : snap2.docs[0].ref;
        const connId = doc.id;
        await updateConnection(connId, () => docRef.update({
          status: 'pending',
          ended_reason: null,
          chat_started_at: null,
          face_reveal_available_at: null,
          face_reveal_expires_at: null,
          from_face_reveal: 0,
          to_face_reveal: 0,
          meeting_code: null,
          from_last_read_at: null,
          to_last_read_at: null
        }));
        return { success: true, reconnected: true };
      }
      return { error: 'Connection already exists', status: doc.status };
    }
    
    const connId = await getNextId('connections');
    await updateConnection(connId, () => firestore.collection('connections').doc(String(connId)).set({
      id: connId,
      from_user_id: Number(fromId),
      to_user_id: Number(toId),
      status: 'pending',
      created_at: new Date().toISOString(),
      chat_started_at: null,
      face_reveal_available_at: null,
      face_reveal_expires_at: null,
      from_face_reveal: 0,
      to_face_reveal: 0,
      meeting_code: null,
      from_last_read_at: null,
      to_last_read_at: null
    }));
    
    return { success: true };
  },

  async dismiss(fromId, toId) {
    const firestore = getDB();
    const snap1 = await firestore.collection('connections')
      .where('from_user_id', '==', Number(fromId))
      .where('to_user_id', '==', Number(toId))
      .limit(1).get();
    const snap2 = await firestore.collection('connections')
      .where('from_user_id', '==', Number(toId))
      .where('to_user_id', '==', Number(fromId))
      .limit(1).get();
    const doc = !snap1.empty ? snap1.docs[0] : (!snap2.empty ? snap2.docs[0] : null);
    if (doc) {
      await updateConnection(doc.data().id, () => doc.ref.update({ status: 'rejected' }));
    } else {
      const connId = await getNextId('connections');
      await updateConnection(connId, () => firestore.collection('connections').doc(String(connId)).set({
        id: connId,
        from_user_id: Number(fromId),
        to_user_id: Number(toId),
        status: 'rejected',
        created_at: new Date().toISOString(),
        chat_started_at: null,
        face_reveal_available_at: null,
        face_reveal_expires_at: null,
        from_face_reveal: 0,
        to_face_reveal: 0,
        meeting_code: null,
        from_last_read_at: null,
        to_last_read_at: null
      }));
    }
    return { success: true };
  },

  async revoke(connectionId, userId) {
    const firestore = getDB();
    const docRef = firestore.collection('connections').doc(String(connectionId));
    const doc = await docRef.get();
    if (!doc.exists) return { error: 'Connection not found' };
    const conn = doc.data();
    if (conn.from_user_id !== Number(userId)) {
      return { error: 'Not authorized to revoke this request' };
    }
    if (conn.status !== 'pending') {
      return { error: 'Cannot revoke a request that is not pending' };
    }
    await updateConnection(connectionId, () => docRef.delete());
    return { success: true };
  },

  async getConnectedUserIds(userId) {
    const firestore = getDB();
    const activeOrPendingStatuses = ['pending', 'accepted', 'revealed'];
    const numId = Number(userId);
    const ids = [];

    try {
      const [snap1, snap2] = await Promise.all([
        firestore.collection('connections')
          .where('from_user_id', '==', numId)
          .where('status', 'in', activeOrPendingStatuses)
          .get(),
        firestore.collection('connections')
          .where('to_user_id', '==', numId)
          .where('status', 'in', activeOrPendingStatuses)
          .get()
      ]);
      snap1.forEach(doc => ids.push(doc.data().to_user_id));
      snap2.forEach(doc => ids.push(doc.data().from_user_id));
    } catch (err) {
      console.warn('Firestore composite index missing for getConnectedUserIds — falling back to in-memory filter.');
      try {
        const [snap1, snap2] = await Promise.all([
          firestore.collection('connections').where('from_user_id', '==', numId).get(),
          firestore.collection('connections').where('to_user_id', '==', numId).get()
        ]);
        snap1.forEach(doc => {
          const d = doc.data();
          if (activeOrPendingStatuses.includes(d.status)) ids.push(d.to_user_id);
        });
        snap2.forEach(doc => {
          const d = doc.data();
          if (activeOrPendingStatuses.includes(d.status)) ids.push(d.from_user_id);
        });
      } catch (fallbackErr) {
        console.error('getConnectedUserIds fallback error:', fallbackErr);
      }
    }
    return [...new Set(ids)];
  },

  async getPendingForUser(userId) {
    const snapshot = await getDB().collection('connections')
      .where('to_user_id', '==', Number(userId))
      .where('status', '==', 'pending')
      .get();
      
    // Fetch partner profiles with a bounded concurrency of 6 (instead of an
    // unbounded Promise.all) — userOps.getById is cached, so this is cheap on
    // warm cache and bounded on cold cache.
    const connections = (await mapWithConcurrency(snapshot.docs, 6, async (doc) => {
      const conn = doc.data();
      const sender = await userOps.getById(conn.from_user_id);
      if (!sender) return null;
      return {
        ...conn,
        username: sender.username,
        bio: sender.bio,
        hobbies: sender.hobbies,
        avatar: sender.avatar,
        gender: sender.gender
      };
    })).filter(Boolean);

    return connections.sort((a, b) => b.created_at.localeCompare(a.created_at));
  },

  async getSentRequests(userId) {
    const snapshot = await getDB().collection('connections')
      .where('from_user_id', '==', Number(userId))
      .where('status', '==', 'pending')
      .get();
      
    const connections = (await mapWithConcurrency(snapshot.docs, 6, async (doc) => {
      const conn = doc.data();
      const receiver = await userOps.getById(conn.to_user_id);
      if (!receiver) return null;
      return {
        ...conn,
        username: receiver.username,
        bio: receiver.bio,
        hobbies: receiver.hobbies,
        avatar: receiver.avatar,
        gender: receiver.gender
      };
    })).filter(Boolean);

    return connections.sort((a, b) => b.created_at.localeCompare(a.created_at));
  },

  async respond(connectionId, userId, action) {
    const firestore = getDB();
    const connDocRef = firestore.collection('connections').doc(String(connectionId));
    let result;
    await updateConnection(connectionId, () => firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(connDocRef);
      if (!doc.exists) {
        result = { error: 'Connection not found' };
        return;
      }
      const conn = doc.data();
      if (conn.to_user_id !== Number(userId)) {
        result = { error: 'Not authorized' };
        return;
      }
      if (conn.status !== 'pending') {
        result = { error: 'Already responded' };
        return;
      }

      if (action === 'reject') {
        transaction.update(connDocRef, { status: 'rejected' });
        result = { success: true, status: 'rejected' };
        return;
      }

      const now = new Date();
      const faceRevealAvailable = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString();
      const faceRevealExpires = new Date(now.getTime() + 11 * 24 * 60 * 60 * 1000).toISOString();
      transaction.update(connDocRef, {
        status: 'accepted',
        chat_started_at: now.toISOString(),
        face_reveal_available_at: faceRevealAvailable,
        face_reveal_expires_at: faceRevealExpires,
        from_face_reveal: 0,
        to_face_reveal: 0,
        face_reveal_declined_by: null,
        meeting_code: null
      });
      result = {
        success: true,
        chat_started_at: now.toISOString(),
        face_reveal_available_at: faceRevealAvailable,
        face_reveal_expires_at: faceRevealExpires
      };
    }));
    return result || { error: 'Unable to respond to this request' };
  },

  async getActiveConnections(userId) {
    const firestore = getDB();
    const activeStatuses = ACTIVE_CONNECTION_STATUSES;
    const numId = Number(userId);
    let connections = [];

    try {
      const [snap1, snap2] = await Promise.all([
        firestore.collection('connections')
          .where('from_user_id', '==', numId)
          .where('status', 'in', activeStatuses)
          .get(),
        firestore.collection('connections')
          .where('to_user_id', '==', numId)
          .where('status', 'in', activeStatuses)
          .get()
      ]);
      connections = [...snap1.docs, ...snap2.docs].map(doc => doc.data());
    } catch (err) {
      console.warn('Firestore composite index missing for getActiveConnections — falling back to in-memory filter.');
      try {
        const [snap1, snap2] = await Promise.all([
          firestore.collection('connections').where('from_user_id', '==', numId).get(),
          firestore.collection('connections').where('to_user_id', '==', numId).get()
        ]);
        const docs = [...snap1.docs, ...snap2.docs];
        connections = docs.map(doc => doc.data()).filter(d => activeStatuses.includes(d.status));
      } catch (fallbackErr) {
        console.error('getActiveConnections fallback error:', fallbackErr);
      }
    }
    // Read receipt state is chat metadata, not relationship state. Keep it in
    // Supabase with messages so opening a chat list does not read Firestore
    // fields that are updated for every incoming message.
    const receiptMap = await readReceiptOps.getForConnectionIds(
      userId,
      connections.map(conn => conn.id)
    );

    const active = (await mapWithConcurrency(connections, 6, async (conn) => {
      const otherId = conn.from_user_id === Number(userId) ? conn.to_user_id : conn.from_user_id;
      const [otherUser, lastMsg] = await Promise.all([
        userOps.getById(otherId),
        getLastMessageForConnection(conn.id).catch(() => null)
      ]);
      if (!otherUser) return null;

      const isFrom = conn.from_user_id === Number(userId);
      // `null` means the Supabase migration has not been applied yet, so retain
      // the legacy Firestore fields during the rollout. Once migrated, an empty
      // map entry correctly means that this user has not read the chat yet.
      const myLastReadAt = receiptMap
        ? (receiptMap.get(String(conn.id)) || null)
        : (isFrom ? conn.from_last_read_at : conn.to_last_read_at);

      return {
        ...conn,
        other_username: otherUser.username,
        other_bio: otherUser.bio,
        other_hobbies: otherUser.hobbies,
        other_avatar: otherUser.avatar,
        other_user_id: otherUser.id,
        last_message: lastMsg ? (Number(lastMsg.is_encrypted) === 1 ? 'Encrypted message' : lastMsg.content) : null,
        last_message_time: lastMsg ? lastMsg.created_at : null,
        last_sender_id: lastMsg ? lastMsg.sender_id : null,
        last_read: lastMsg ? (lastMsg.sender_id === Number(userId) ? true : (myLastReadAt && lastMsg.created_at <= myLastReadAt)) : true
      };
    })).filter(Boolean);
    
    return active.sort((a, b) => {
      const aTime = a.last_message_time || a.chat_started_at;
      const bTime = b.last_message_time || b.chat_started_at;
      return bTime.localeCompare(aTime);
    });
  },

  async getConnection(connectionId, userId) {
    // ── Cache check ──────────────────────────────────────────────────────────
    // NOTE: The cache stores only the raw Firestore connection fields plus the
    // two derived last_read_at fields. Embedded partner profile data (username,
    // avatar, bio, etc.) is intentionally NOT cached here — it is fetched fresh
    // from userOps.getById() on every call. userOps has its own short-lived TTL
    // cache so this costs at most one extra cache lookup, not a Firestore read.
    // This means profile edits are reflected immediately without needing a
    // separate cache-invalidation path wired to profile update routes.
    const cacheKey = `${connectionId}:${userId}`;
    const cached = _connCache.get(cacheKey);
    const isHit = cached && (Date.now() - cached.ts) < CONNECTION_CACHE_TTL_MS;

    let conn;
    if (isHit) {
      // Cache hit — skip Firestore, use stored raw conn fields
      conn = cached.data;
    } else {
      // Cache miss or expired — read from Firestore
      const firestore = getDB();
      const doc = await firestore.collection('connections').doc(String(connectionId)).get();
      if (!doc.exists) return null;
      conn = doc.data();

      if (conn.from_user_id !== Number(userId) && conn.to_user_id !== Number(userId)) {
        return null;
      }

      // ── Write-back: delete first to reset insertion order for LRU eviction ──
      // Calling .set() without .delete() updates the value in-place but keeps
      // the entry's original insertion position — so the cap would evict the
      // wrong (no-longer-oldest) entry. Always delete-then-set.
      if (_connCache.size >= CONNECTION_CACHE_MAX && !_connCache.has(cacheKey)) {
        // Evict the oldest entry only when adding a brand-new key
        const oldestKey = _connCache.keys().next().value;
        if (oldestKey) {
          const oldestConnId = oldestKey.split(':')[0];
          _connCache.delete(oldestKey);
          _unindexCacheKey(oldestConnId, oldestKey);
        }
      }
      _connCache.delete(cacheKey);           // remove old position (no-op on first insert)
      _connCache.set(cacheKey, { data: conn, ts: Date.now() }); // re-insert at tail
      _indexCacheKey(connectionId, cacheKey); // maintain reverse index
    }

    // ── Always fetch user profiles (userOps has its own 10-min TTL cache) ──────
    const otherId = conn.from_user_id === Number(userId) ? conn.to_user_id : conn.from_user_id;
    const myId    = conn.from_user_id === Number(userId) ? conn.from_user_id : conn.to_user_id;

    const [otherUser, myUser, receiptMap] = await Promise.all([
      userOps.getById(otherId),
      userOps.getById(myId),
      readReceiptOps.getForConnection(connectionId, [myId, otherId])
    ]);

    if (!otherUser || !myUser) {
      console.error(`getConnection: connection ${connectionId} exists but user lookup failed — otherId=${otherId} found=${!!otherUser}, myId=${myId} found=${!!myUser}`);
      // Do NOT cache _dataIntegrityError — it may be transient
      return { _dataIntegrityError: true, connectionId };
    }

    const isFrom = conn.from_user_id === Number(userId);
    const myLastReadAt = receiptMap
      ? (receiptMap.get(String(myId)) || null)
      : (isFrom ? conn.from_last_read_at : conn.to_last_read_at);
    const otherLastReadAt = receiptMap
      ? (receiptMap.get(String(otherId)) || null)
      : (isFrom ? conn.to_last_read_at : conn.from_last_read_at);

    return {
      ...conn,
      other_username:    otherUser.username,
      other_gender:      otherUser.gender,
      other_bio:         otherUser.bio,
      other_hobbies:     otherUser.hobbies,
      other_avatar:      otherUser.avatar,
      other_user_id:     otherUser.id,
      other_public_key:  otherUser.public_key || null,
      my_user_id:        myUser.id,
      my_last_read_at:   myLastReadAt,
      other_last_read_at: otherLastReadAt
    };
  },

  // End connection immediately ("Not Vibing" button)
  // Wrapped in a Firestore transaction to prevent both users from triggering
  // the action simultaneously — only the first to commit sees 'accepted' status.
  // The try-catch converts transaction-abort errors into clean return values
  // so the route handler returns 400 instead of 500.
  async endConnection(connectionId, userId) {
    const firestore = getDB();
    const connDocRef = firestore.collection('connections').doc(String(connectionId));
    
    let otherId = null;
    try {
      await updateConnection(connectionId, () => firestore.runTransaction(async (transaction) => {
        const doc = await transaction.get(connDocRef);
        if (!doc.exists) return; // will result in ended=false, handled below
        const conn = doc.data();
        if (!ACTIVE_CONNECTION_STATUSES.includes(conn.status)) return; // already ended
        if (conn.from_user_id !== Number(userId) && conn.to_user_id !== Number(userId)) return;
        
        const isFrom = conn.from_user_id === Number(userId);
        otherId = isFrom ? conn.to_user_id : conn.from_user_id;
        
        await releaseActiveConnectionLocks(transaction, conn);
        transaction.update(connDocRef, { status: 'rejected', ended_reason: CONNECTION_END_REASONS.NOT_VIBING });
      }));
    } catch (txErr) {
      // Transaction failed for reasons other than our internal guards
      return { error: 'Connection not available. Please try again.' };
    }
    
    if (otherId) {
      return { success: true, ended: true, otherId };
    }
    return { error: 'Connection not active' };
  },

  // Day-10 mutual reveal. Both users must explicitly agree during the reveal window.
  async submitFaceReveal(connectionId, userId) {
    const firestore = getDB();
    const connDocRef = firestore.collection('connections').doc(String(connectionId));
    
    let result = null;
    
    // Pre-read (outside the transaction): if the partner has already revealed,
    // this submit completes the pair and a meeting room is needed. The room is
    // created BEFORE the transaction because the provider API is a network call
    // and must never run inside a Firestore transaction.
    let partnerAlreadyRevealed = false;
    let existingMeetingCode = null;
    try {
      const preDoc = await connDocRef.get();
      if (preDoc.exists) {
        const pre = preDoc.data();
        const preIsFrom = pre.from_user_id === Number(userId);
        partnerAlreadyRevealed = (preIsFrom ? pre.to_face_reveal : pre.from_face_reveal) === 1;
        existingMeetingCode = pre.meeting_code || null;
      }
    } catch (preErr) {
      // Ignore — the transaction re-reads and generateMeetingCode() is the fallback.
    }
    const meetingUrl = (partnerAlreadyRevealed && !existingMeetingCode) ? await createMeetingRoom() : null;
    
    try {
      await updateConnection(connectionId, () => firestore.runTransaction(async (transaction) => {
        const doc = await transaction.get(connDocRef);
        if (!doc.exists) {
          result = { error: 'Connection not found' };
          return;
        }
        const conn = doc.data();
        if (conn.status !== 'accepted') {
          result = { error: 'Connection is no longer active' };
          return;
        }
        if (conn.from_user_id !== Number(userId) && conn.to_user_id !== Number(userId)) {
          result = { error: 'Not authorized' };
          return;
        }
        const now = Date.now();
        if (!conn.face_reveal_available_at || now < new Date(conn.face_reveal_available_at).getTime()) {
          result = { error: 'Face reveal is available on Day 10.' };
          return;
        }
        const expiresAt = conn.face_reveal_expires_at
          ? new Date(conn.face_reveal_expires_at).getTime()
          : new Date(conn.face_reveal_available_at).getTime() + 24 * 60 * 60 * 1000;
        if (now >= expiresAt) {
          result = { error: 'The face reveal window has expired.' };
          return;
        }

        const isFrom = conn.from_user_id === Number(userId);
        const field = isFrom ? 'from_face_reveal' : 'to_face_reveal';
        const otherVal = isFrom ? conn.to_face_reveal : conn.from_face_reveal;
        const bothRevealed = otherVal === 1;
        // meetingUrl covers the normal flow; generateMeetingCode() covers a
        // simultaneous double-submit race (both clicked at once, so the pre-read
        // saw the partner as not-yet-revealed).
        const meetingCode = bothRevealed ? (conn.meeting_code || meetingUrl || generateMeetingCode()) : null;
        transaction.update(connDocRef, bothRevealed
          ? { [field]: 1, status: 'revealed', meeting_code: meetingCode }
          : { [field]: 1 });
        result = { success: true, bothRevealed, meeting_code: meetingCode };
      }));
    } catch (txErr) {
      return { error: 'Failed to process face reveal. Please try again.' };
    }
    
    // A simultaneous double-submit can slip past the pre-read; if that happened,
    // create the room now and persist it so the pair still gets a working link.
    if (result && result.success && result.bothRevealed && !result.meeting_code) {
      const url = await createMeetingRoom();
      if (url) {
        await connDocRef.update({ meeting_code: url }).catch(() => {});
        result.meeting_code = url;
      }
    }
    
    return result || { error: 'Failed to process face reveal. Please try again.' };
  },

  // Face Reveal Decline: One user said no to face reveal
  async declineFaceReveal(connectionId, userId) {
    const firestore = getDB();
    const connDocRef = firestore.collection('connections').doc(String(connectionId));
    let otherId = null;
    let result = null;
    await updateConnection(connectionId, () => firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(connDocRef);
      if (!doc.exists) {
        result = { error: 'Connection not found' };
        return;
      }
      const conn = doc.data();
      if (!ACTIVE_CONNECTION_STATUSES.includes(conn.status)) {
        result = { error: 'Connection not active' };
        return;
      }
      if (conn.from_user_id !== Number(userId) && conn.to_user_id !== Number(userId)) {
        result = { error: 'Not authorized' };
        return;
      }
      if (!conn.face_reveal_available_at || Date.now() < new Date(conn.face_reveal_available_at).getTime()) {
        result = { error: 'Face reveal is available on Day 10.' };
        return;
      }

      const isFrom = conn.from_user_id === Number(userId);
      otherId = isFrom ? conn.to_user_id : conn.from_user_id;

      await releaseActiveConnectionLocks(transaction, conn);
      transaction.update(connDocRef, {
        status: 'rejected',
        ended_reason: CONNECTION_END_REASONS.FACE_REVEAL_DECLINED,
        face_reveal_declined_by: Number(userId)
      });
      result = { success: true, declined: true, otherId };
    }));

    return result || { error: 'Failed to decline face reveal' };
  },

  // End connection after face reveal decline (user chose to disconnect)
  async endAfterDecline(connectionId, userId) {
    const firestore = getDB();
    const connDocRef = firestore.collection('connections').doc(String(connectionId));
    let result = null;
    await updateConnection(connectionId, () => firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(connDocRef);
      if (!doc.exists) {
        result = { error: 'Connection not found' };
        return;
      }
      const conn = doc.data();
      if (conn.status !== 'accepted') {
        result = { error: 'Connection is no longer active' };
        return;
      }
      if (conn.from_user_id !== Number(userId) && conn.to_user_id !== Number(userId)) {
        result = { error: 'Not authorized' };
        return;
      }
      if (!conn.face_reveal_declined_by || Number(conn.face_reveal_declined_by) === Number(userId)) {
        result = { error: 'Only the other participant can end a chat after a declined reveal.' };
        return;
      }
      await releaseActiveConnectionLocks(transaction, conn);
      transaction.update(connDocRef, { status: 'rejected', ended_reason: CONNECTION_END_REASONS.FACE_REVEAL_DECLINED });
      result = { success: true };
    }));
    return result || { error: 'Failed to end connection' };
  },

  /**
   * Retrieves all connections between two users (in either direction).
   * Used for cleanup on block/unblock.
   */
  async getAllBetween(userId1, userId2) {
    const firestore = getDB();
    const snap1 = await firestore.collection('connections')
      .where('from_user_id', '==', Number(userId1))
      .where('to_user_id', '==', Number(userId2))
      .get();
    const snap2 = await firestore.collection('connections')
      .where('from_user_id', '==', Number(userId2))
      .where('to_user_id', '==', Number(userId1))
      .get();
    const results = [];
    snap1.forEach(doc => results.push(doc.data()));
    snap2.forEach(doc => results.push(doc.data()));
    return results;
  },

  async startGame(connectionId, gameType, question) {
    const firestore = getDB();
    const connDocRef = firestore.collection('connections').doc(String(connectionId));
    let finalPayload = null;

    await updateConnection(connectionId, () => firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(connDocRef);
      if (!doc.exists) throw new Error('Connection not found');
      const conn = doc.data() || {};
      const existingGame = conn.active_game || null;

      // Deduplication lock: If an active game already exists and was created within 30s
      // and hasn't been answered by both users, retain the existing game!
      if (existingGame && existingGame.created_at) {
        const gameAgeMs = Date.now() - new Date(existingGame.created_at).getTime();
        const answersCount = Object.keys(existingGame.answers || {}).length;
        if (gameAgeMs < 30000 && answersCount < 2) {
          finalPayload = existingGame;
          return;
        }
      }

      finalPayload = {
        game_type: gameType,
        question,
        answers: {},
        created_at: new Date().toISOString()
      };
      transaction.update(connDocRef, { active_game: finalPayload });
    }));
    return finalPayload;
  },

  async submitGameAnswer(connectionId, userId, answer) {
    const firestore = getDB();
    const connDocRef = firestore.collection('connections').doc(String(connectionId));
    
    let bothAnswered = false;
    let gameData = null;
    await updateConnection(connectionId, () => firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(connDocRef);
      if (!doc.exists) throw new Error('Connection not found');
      const conn = doc.data();
      const activeGame = conn.active_game || null;
      if (!activeGame) throw new Error('No active game found');
      
      const answers = activeGame.answers || {};
      answers[String(userId)] = answer;
      activeGame.answers = answers;
      
      transaction.update(connDocRef, { active_game: activeGame });
      
      const otherId = conn.from_user_id === Number(userId) ? conn.to_user_id : conn.from_user_id;
      bothAnswered = (answers[String(userId)] !== undefined) && (answers[String(otherId)] !== undefined);
      gameData = activeGame;
    }));
    
    return { success: true, bothAnswered, gameData };
  },

  async clearGame(connectionId, gameCreatedAt = null) {
    const firestore = getDB();
    const connDocRef = firestore.collection('connections').doc(String(connectionId));
    let actuallyCleared = false;
    if (gameCreatedAt) {
      await updateConnection(connectionId, () => firestore.runTransaction(async (transaction) => {
        const doc = await transaction.get(connDocRef);
        if (!doc.exists) return;
        const conn = doc.data();
        const activeGame = conn.active_game || null;
        if (activeGame && activeGame.created_at === gameCreatedAt) {
          transaction.update(connDocRef, { active_game: null });
          actuallyCleared = true;
        }
      }));
    } else {
      await updateConnection(connectionId, () => connDocRef.update({ active_game: null }));
      actuallyCleared = true;
    }
    return { success: true, cleared: actuallyCleared };
  },

  
  async sweepExpired() {
    const firestore = getDB();
    const now = new Date().toISOString();
    
    let faceRevealsExpired = 0;
    /** @type {Array<{id: number, from_user_id: number, to_user_id: number}>} */
    const allExpiredIds = [];
    let lastDoc = null;
    const PAGE_SIZE = 500;
    
    // Paginate through all accepted connections in batches of 500 to handle large datasets.
    // Uses orderBy('__name__') which is auto-indexed in Firestore (no custom index needed).
    while (true) {
      let query = firestore.collection('connections')
        .where('status', '==', 'accepted')
        .orderBy('__name__')
        .limit(PAGE_SIZE);
      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }
      const snapshot = await query.get();
      if (snapshot.empty) break;
      
      const batch = firestore.batch();
      let pageChanged = false;
      const pageExpiredIds = [];
      
      for (const doc of snapshot.docs) {
        lastDoc = doc; // Track for pagination
        const conn = doc.data();
        
        // Face reveal opens on Day 10 and stays open for 24 hours. Older records
        // without an explicit expiry use the same 24-hour compatibility window.
        const faceExpiry = conn.face_reveal_expires_at || (conn.face_reveal_available_at
          ? new Date(new Date(conn.face_reveal_available_at).getTime() + 24 * 60 * 60 * 1000).toISOString()
          : null);
        if (faceExpiry && faceExpiry < now) {
          if (conn.from_face_reveal === 0 || conn.to_face_reveal === 0) {
            batch.update(doc.ref, { status: 'expired', ended_reason: CONNECTION_END_REASONS.FACE_REVEAL_TIMEOUT });
            batch.delete(activeConnectionLockRef(conn.from_user_id));
            batch.delete(activeConnectionLockRef(conn.to_user_id));
            allExpiredIds.push({ id: conn.id, from_user_id: conn.from_user_id, to_user_id: conn.to_user_id });
            pageExpiredIds.push(conn.id);
            faceRevealsExpired++;
            pageChanged = true;
            continue; // skip to next doc — this connection is handled
          }
        }
        
      }
      
      // Only commit if there were actual changes — avoid wasted Firestore writes
      if (pageChanged) {
        await updateConnections(pageExpiredIds, () => batch.commit());
      }
      
      // If we got fewer results than the page size, we've processed everything
      if (snapshot.size < PAGE_SIZE) break;
    }
    
    return { faceRevealsExpired, expiredConnections: allExpiredIds };
  },

  async getConnectionById(connectionId) {
    const doc = await getDB().collection('connections').doc(String(connectionId)).get();
    return doc.exists ? doc.data() : null;
  }
};

// Message operations — backed by Supabase Postgres (NOT Firestore)
// The Firestore connection doc (ownership/permission check) is still used
// by connectionOps.getConnection() in every route handler BEFORE these run.
const { getSupabase, supabaseBreaker } = require('./db/supabase');

// Read receipt writes are coalesced so a busy chat does not turn each incoming
// message into a database mutation. The client also debounces the API calls;
// this server-side guard covers multiple tabs and retrying clients.
const READ_RECEIPT_MIN_WRITE_INTERVAL_MS = 10 * 1000;
const READ_RECEIPT_CACHE_TTL_MS = 15 * 1000;
const _readReceiptCache = new Map();

function receiptCacheKey(connectionId, userId) {
  return `${Number(connectionId)}:${Number(userId)}`;
}

function getCachedReceipt(connectionId, userId) {
  const entry = _readReceiptCache.get(receiptCacheKey(connectionId, userId));
  if (!entry || Date.now() - entry.cachedAt >= READ_RECEIPT_CACHE_TTL_MS) return undefined;
  return entry.lastReadAt;
}

function setCachedReceipt(connectionId, userId, lastReadAt) {
  const persistedAt = new Date(lastReadAt || 0).getTime();
  _readReceiptCache.set(receiptCacheKey(connectionId, userId), {
    lastReadAt: lastReadAt || null,
    cachedAt: Date.now(),
    // A cached database read must not suppress a new acknowledgement. Only a
    // recent successful write is eligible for the 10-second coalescing window.
    lastWriteAt: Number.isFinite(persistedAt) ? persistedAt : 0
  });
}

const readReceiptOps = {
  async getForConnection(connectionId, userIds) {
    const ids = [...new Set((userIds || []).map(Number).filter(Number.isSafeInteger))];
    const result = new Map();
    if (!ids.length) return result;

    const missingIds = ids.filter(userId => getCachedReceipt(connectionId, userId) === undefined);
    ids.forEach(userId => {
      const cached = getCachedReceipt(connectionId, userId);
      if (cached !== undefined) result.set(String(userId), cached);
    });
    if (!missingIds.length) return result;

    try {
      const { data, error } = await getSupabase()
        .from('chat_read_receipts')
        .select('user_id, last_read_at')
        .eq('connection_id', Number(connectionId))
        .in('user_id', missingIds);
      if (error) throw error;

      const byUserId = new Map((data || []).map(row => [String(row.user_id), row.last_read_at]));
      missingIds.forEach(userId => {
        const lastReadAt = byUserId.get(String(userId)) || null;
        setCachedReceipt(connectionId, userId, lastReadAt);
        result.set(String(userId), lastReadAt);
      });
      return result;
    } catch (err) {
      // Returning null lets callers use the legacy fields until the SQL
      // migration is applied; it avoids an outage during a rolling deploy.
      console.warn('readReceiptOps.getForConnection fallback:', err.message);
      return null;
    }
  },

  async getForConnectionIds(userId, connectionIds) {
    const ids = [...new Set((connectionIds || []).map(Number).filter(Number.isSafeInteger))];
    const result = new Map();
    if (!ids.length) return result;

    const missingIds = ids.filter(connectionId => getCachedReceipt(connectionId, userId) === undefined);
    ids.forEach(connectionId => {
      const cached = getCachedReceipt(connectionId, userId);
      if (cached !== undefined) result.set(String(connectionId), cached);
    });
    if (!missingIds.length) return result;

    try {
      const { data, error } = await getSupabase()
        .from('chat_read_receipts')
        .select('connection_id, last_read_at')
        .eq('user_id', Number(userId))
        .in('connection_id', missingIds);
      if (error) throw error;

      const byConnectionId = new Map((data || []).map(row => [String(row.connection_id), row.last_read_at]));
      missingIds.forEach(connectionId => {
        const lastReadAt = byConnectionId.get(String(connectionId)) || null;
        setCachedReceipt(connectionId, userId, lastReadAt);
        result.set(String(connectionId), lastReadAt);
      });
      return result;
    } catch (err) {
      console.warn('readReceiptOps.getForConnectionIds fallback:', err.message);
      return null;
    }
  },

  async markAsRead(connectionId, userId) {
    const key = receiptCacheKey(connectionId, userId);
    const existing = _readReceiptCache.get(key);
    const nowMs = Date.now();
    if (existing && nowMs - existing.lastWriteAt < READ_RECEIPT_MIN_WRITE_INTERVAL_MS) {
      return { count: 0, readAt: existing.lastReadAt, coalesced: true };
    }

    const readAt = new Date(nowMs).toISOString();
    const { error } = await getSupabase()
      .from('chat_read_receipts')
      .upsert({
        connection_id: Number(connectionId),
        user_id: Number(userId),
        last_read_at: readAt
      }, { onConflict: 'connection_id,user_id' });
    if (error) throw error;

    _readReceiptCache.set(key, { lastReadAt: readAt, cachedAt: nowMs, lastWriteAt: nowMs });
    return { count: 1, readAt };
  }
};

// Delta-sync fetches (REST fallback polling) are capped separately from full
// page loads so a broken/malicious client can't pull hundreds of messages on
// every poll. Configurable via MESSAGE_DELTA_LIMIT; default 100.
const DELTA_FETCH_LIMIT = Number(process.env.MESSAGE_DELTA_LIMIT) || 100;

const messageOps = {
  // ── INSERT ──────────────────────────────────────────────────────────────────
  // Supabase table schema: id, connection_id, sender_id, content, reactions,
  //   created_at, deleted_at, deleted_by, is_voice (int), voice_duration (int),
  //   is_encrypted (int), iv (text), read_at (timestamptz)
  // All fields are now persisted directly in the INSERT — no merge-patching.
  async send(connectionId, senderId, content, isVoice = 0, voiceDuration = 0, isEncrypted = 0, iv = null, clientUuid = null) {
    try {
      const supabase = getSupabase();
      if (clientUuid) {
        try {
          const { data: existing } = await supabase
            .from('messages')
            .select('*')
            .eq('connection_id', Number(connectionId))
            .eq('sender_id', Number(senderId))
            .eq('client_uuid', clientUuid)
            .maybeSingle();
          if (existing) return existing;
        } catch (e) {}
      }

      const payload = {
        connection_id:  Number(connectionId),
        sender_id:      Number(senderId),
        content,
        reactions:      {},
        is_voice:       Number(isVoice),
        voice_duration: Number(voiceDuration),
        is_encrypted:   Number(isEncrypted),
        iv:             iv || null
      };
      if (clientUuid) payload.client_uuid = clientUuid;

      const write = clientUuid
        ? supabase
          .from('messages')
          // The unique index in the matching SQL migration makes a
          // retry safe even when two requests race past the initial lookup.
          .upsert(payload, {
            onConflict: 'connection_id,sender_id,client_uuid',
            ignoreDuplicates: true
          })
          .select()
          .maybeSingle()
        : supabase
          .from('messages')
          .insert(payload)
          .select()
          .single();

      const { data, error } = await write;

      if (error) {
        if (error.code === 'PGRST204' || (error.message && error.message.includes('client_uuid'))) {
          delete payload.client_uuid;
          const { data: retryData, error: retryErr } = await supabase
            .from('messages')
            .insert(payload)
            .select()
            .single();
          if (retryErr) throw retryErr;
          setCachedLastMessage(connectionId, retryData);
          return retryData;
        }
        throw error;
      }

      // ignoreDuplicates returns no row for the racing/retry request. Fetch
      // the original message so callers can reconcile their optimistic bubble.
      if (!data && clientUuid) {
        const { data: existing, error: existingErr } = await supabase
          .from('messages')
          .select('*')
          .eq('connection_id', Number(connectionId))
          .eq('sender_id', Number(senderId))
          .eq('client_uuid', clientUuid)
          .maybeSingle();
        if (existingErr || !existing) throw existingErr || new Error('Message retry could not be reconciled');
        setCachedLastMessage(connectionId, existing);
        return existing;
      }

      setCachedLastMessage(connectionId, data);
      return data;
    } catch (err) {
      console.error('messageOps.send error:', err.message);
      throw new Error('Failed to send message');
    }
  },

  // ── BULK INSERT MESSAGES ──────────────────────────────────────────────────
  // Single multi-row insert statement with chunking for high throughput & minimum round trips
  async bulkSend(messagesList) {
    if (!Array.isArray(messagesList) || messagesList.length === 0) return [];
    try {
      const supabase = getSupabase();
      const BATCH_SIZE = 100; // Chunk into 100 rows per batch to avoid oversized payload limits
      const insertedResults = [];

      for (let i = 0; i < messagesList.length; i += BATCH_SIZE) {
        const chunk = messagesList.slice(i, i + BATCH_SIZE).map(m => ({
          connection_id:  Number(m.connectionId || m.connection_id),
          sender_id:      Number(m.senderId || m.sender_id),
          content:        m.content,
          reactions:      m.reactions || {},
          is_voice:       Number(m.isVoice || m.is_voice || 0),
          voice_duration: Number(m.voiceDuration || m.voice_duration || 0),
          is_encrypted:   Number(m.isEncrypted || m.is_encrypted || 0),
          iv:             m.iv || null
        }));

        const { data, error } = await supabase
          .from('messages')
          .insert(chunk)
          .select();

        if (error) throw error;
        if (data) insertedResults.push(...data);
      }
      return insertedResults;
    } catch (err) {
      console.error('messageOps.bulkSend error:', err.message);
      throw new Error('Failed to bulk send messages');
    }
  },

  // ── TOGGLE REACTION ──────────────────────────────────────────────────────────
  // Single read + single write against Supabase 'messages' reactions jsonb column.
  // Moved from Firestore msgRef.get() → msgRef.update({ reactions }).
  async toggleReaction(messageId, userId, connectionId, emoji) {
    try {
      const supabase = getSupabase();

      // Read current reactions from Supabase
      const { data: msg, error: fetchErr } = await supabase
        .from('messages')
        .select('id, connection_id, reactions, deleted_at')
        .eq('id', messageId)
        .is('deleted_at', null)
        .single();

      if (fetchErr || !msg) return { error: 'Message not found' };
      if (connectionId && Number(msg.connection_id) !== Number(connectionId)) return { error: 'Mismatched connection' };

      // Toggle userId in/out of the emoji's array (application-level, no extra table)
      const reactions = msg.reactions || {};
      const users = reactions[emoji] || [];
      const idx = users.indexOf(Number(userId));
      if (idx === -1) users.push(Number(userId)); else users.splice(idx, 1);
      if (users.length === 0) delete reactions[emoji]; else reactions[emoji] = users;

      // Write updated reactions object back
      const { error: updateErr } = await supabase
        .from('messages')
        .update({ reactions })
        .eq('id', messageId);

      if (updateErr) throw updateErr;
      return { success: true, reactions };
    } catch (err) {
      console.error('messageOps.toggleReaction error:', err.message);
      return { error: 'Failed to toggle reaction' };
    }
  },

  // ── SOFT DELETE (tombstone) ──────────────────────────────────────────────────
  // Moved from Firestore update({ deleted: 1 }) → Supabase update({ deleted_at, deleted_by }).
  // Hard-deletes are never performed; the row is tombstoned so delta-sync can still
  // return the deletion event to the other user.
  async deleteMessage(messageId, userId, connectionId) {
    try {
      const supabase = getSupabase();

      // Verify ownership before tombstoning
      const { data: msg, error: fetchErr } = await supabase
        .from('messages')
        .select('id, sender_id, connection_id, deleted_at')
        .eq('id', messageId)
        .single();

      if (fetchErr || !msg) return { error: 'Message not found' };
      if (msg.deleted_at) return { error: 'Message already deleted' };
      if (connectionId && Number(msg.connection_id) !== Number(connectionId)) return { error: 'Message does not belong to this connection' };

      const { error: updateErr } = await supabase
        .from('messages')
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: Number(userId),
          content:    '',         // clear content as well
          reactions:  {}          // clear reactions on deletion
        })
        .eq('id', messageId);

      if (updateErr) throw updateErr;
      evictLastMessage(msg.connection_id);
      return { success: true };
    } catch (err) {
      console.error('messageOps.deleteMessage error:', err.message);
      return { error: 'Failed to delete message' };
    }
  },

  // ── BULK SOFT-DELETE ON CHAT END (evidence preservation) ──────────────────────
  // Called when a connection ends ("Not Vibing" / end-after-decline). Messages are
  // tombstoned instead of hard-deleted: they vanish from the users' views immediately
  // (getForConnection filters deleted_at IS NULL) but the rows survive so harassment
  // evidence can be reviewed if a report was filed. purgeExpiredSoftDeleted() below
  // hard-deletes them after the retention window.
  async softDeleteAllForConnection(connectionId, deletedBy) {
    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from('messages')
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: Number(deletedBy) || 0,
          reactions: {}  // drop reactions but KEEP content for evidence review
        })
        .eq('connection_id', Number(connectionId))
        .is('deleted_at', null);
      if (error) throw error;
      evictLastMessage(Number(connectionId));
      return { success: true };
    } catch (err) {
      console.error('messageOps.softDeleteAllForConnection error:', err.message);
      return { error: 'Failed to archive messages' };
    }
  },

  // ── RETENTION SWEEP ───────────────────────────────────────────────────────────
  // Hard-deletes tombstoned messages after the retention window. Chats that were
  // reported keep their evidence longer so the safety team can still review them.
  // Runs from the 30-minute background sweep; batched so we never load huge pages.
  async purgeExpiredSoftDeleted() {
    const UNREPORTED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days
    const REPORTED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days when reported
    try {
      const reportedConnIds = await reportOps.getConnectionIds();
      const shortCutoff = new Date(Date.now() - UNREPORTED_RETENTION_MS).toISOString();
      const longCutoff = new Date(Date.now() - REPORTED_RETENTION_MS).toISOString();
      const supabase = getSupabase();
      let purged = 0;
      let lastSeenId = 0;

      while (true) {
        const { data, error } = await supabase
          .from('messages')
          .select('id, connection_id, deleted_at')
          .not('deleted_at', 'is', null)
          .lt('deleted_at', shortCutoff)
          .gt('id', lastSeenId)
          .order('id', { ascending: true })
          .limit(1000);
        if (error) throw error;
        if (!data || data.length === 0) break;

        lastSeenId = data[data.length - 1].id;

        const toDelete = data.filter(m => {
          const reported = reportedConnIds.has(Number(m.connection_id));
          return reported ? String(m.deleted_at) < longCutoff : true;
        });

        if (toDelete.length > 0) {
          const { error: delErr } = await supabase
            .from('messages')
            .delete()
            .in('id', toDelete.map(m => m.id));
          if (delErr) throw delErr;
          purged += toDelete.length;
        }
        if (data.length < 1000) break;
      }
      return purged;
    } catch (err) {
      console.error('messageOps.purgeExpiredSoftDeleted error:', err.message);
      return 0;
    }
  },

  // ── FETCH ALL (internal use, e.g. read-receipt count) ────────────────────────
  // Moved from Firestore unordered collection scan → Supabase ordered query.
  async getForConnection(connectionId) {
    try {
      return await supabaseBreaker.execute(async () => {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('connection_id', Number(connectionId))
          .is('deleted_at', null)
          .order('created_at', { ascending: true });

        if (error) throw error;
        return data || [];
      }, () => []);
    } catch (err) {
      console.error('messageOps.getForConnection error:', err.message);
      return [];
    }
  },

  // ── MARK AS READ ─────────────────────────────────────────────────────────────
  // Ownership is verified by the route before this is called. Read state lives
  // beside messages in Supabase, which removes a Firestore write from the hot
  // path for every received message.
  async markAsRead(connectionId, userId, verifiedConn = null) {
    try {
      const conn = verifiedConn;
      if (!conn) return { count: 0 };
      if (conn.from_user_id !== Number(userId) && conn.to_user_id !== Number(userId)) {
        return { count: 0 };
      }
      return await readReceiptOps.markAsRead(connectionId, userId);
    } catch (err) {
      console.error('messageOps.markAsRead error:', err.message);
      return { count: 0 };
    }
  },

  // ── DELTA-SYNC FETCH (primary read path for REST fallback polling) ────────────
  // Moved from Firestore collection query → Supabase table query.
  // When `since` (ISO string) is provided, only messages newer than that timestamp
  // are fetched — this is the core delta-sync optimization.
  // Tombstoned messages (deleted_at IS NOT NULL) are excluded.
  // Returns oldest-first (ascending) to match the existing client contract.
  async getRecentForConnection(connectionId, limit = 30, since = null, before = null) {
    try {
      const supabase = getSupabase();

      // Include deleted messages so the client can show the "deleted" placeholder.
      let query = supabase
        .from('messages')
        .select('*')
        .eq('connection_id', Number(connectionId));

      // Delta sync: only fetch messages newer than the client's last-seen timestamp
      if (since) {
        query = query.gt('created_at', since);
      }

      // Pagination cursor: fetch messages OLDER than the given timestamp
      // Used by "Load More" / infinite scroll upward in the chat UI
      if (before) {
        query = query.lt('created_at', before);
      }

      // Fetch limit+1 to detect if more pages exist without an extra count query
      const fetchLimit = since ? DELTA_FETCH_LIMIT : limit + 1;

      // Fetch newest-first so .limit() trims the right end, then reverse in JS
      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(fetchLimit);

      if (error) throw error;

      const rows = data || [];

      // When doing delta sync (since param), return all — no pagination needed
      if (since) {
        return rows.reverse();
      }

      // Determine if more messages exist before this page
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;

      // Reverse to oldest-first — same return contract as before
      const messages = pageRows.reverse();

      // Attach has_more flag on the array itself so the route handler can expose it
      messages._hasMore = hasMore;
      return messages;
    } catch (err) {
      console.error('messageOps.getRecentForConnection error:', err.message);
      return [];
    }
  }
};

// OTP operations.
// Security model:
//  • One active OTP per email, stored at otps/{email}. Generating again simply
//    replaces the previous code (matches the old "latest wins" semantics).
//  • The code is stored ONLY as an HMAC-SHA256 digest keyed by SESSION_SECRET
//    (a pepper), so a Firestore read can never reveal a usable OTP.
//  • verify() validates AND marks-used inside a single Firestore transaction,
//    so two concurrent requests with the same code cannot both pass; failed
//    attempts increment a per-code counter inside the same transaction.
const OTP_TTL_MS = 10 * 60 * 1000;

function hashOtp(otp) {
  const secret = process.env.SESSION_SECRET || 'delulu-otp-pepper';
  return crypto.createHmac('sha256', secret).update(String(otp)).digest('hex');
}

function otpDocKey(email) {
  return String(email == null ? '' : email).toLowerCase().trim();
}

const otpOps = {
  async create(email, otp, expiresAt) {
    const firestore = getDB();
    const cleanEmail = otpDocKey(email);
    const ref = firestore.collection('otps').doc(cleanEmail);
    await ref.set({
      id: cleanEmail,
      email: cleanEmail,
      otp_hash: hashOtp(otp),
      used: 0,
      expires_at: new Date(expiresAt).toISOString(),
      created_at: new Date().toISOString(),
      attempts: 0
    });
    return cleanEmail;
  },

  async getActiveOTP(email) {
    const doc = await getDB().collection('otps').doc(otpDocKey(email)).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (data.used === 1 || new Date(data.expires_at).getTime() < Date.now()) return null;
    return data;
  },

  async incrementAttempts(email) {
    await getDB().collection('otps').doc(otpDocKey(email))
      .update({ attempts: FieldValue.increment(1) })
      .catch(() => {});
  },

  async markUsed(id) {
    await getDB().collection('otps').doc(String(id))
      .update({ used: 1, used_at: new Date().toISOString() })
      .catch(() => {});
  },

  async cleanExpired() {
    const firestore = getDB();
    const now = new Date().toISOString();
    let deletedCount = 0;
    try {
      // Expired OTPs — bounded incremental sweep.
      const snapshot = await firestore.collection('otps')
        .where('expires_at', '<', now)
        .limit(200)
        .get();
      const batch = firestore.batch();
      let count = 0;
      snapshot.forEach(doc => { batch.delete(doc.ref); count++; });
      if (count > 0) await batch.commit();
      deletedCount += count;

      // Already-used OTPs — bounded incremental sweep.
      const usedSnapshot = await firestore.collection('otps')
        .where('used', '==', 1)
        .limit(100)
        .get();
      const usedBatch = firestore.batch();
      let usedCount = 0;
      usedSnapshot.forEach(doc => { usedBatch.delete(doc.ref); usedCount++; });
      if (usedCount > 0) await usedBatch.commit();
      deletedCount += usedCount;
    } catch (err) {
      console.error('otpOps.cleanExpired error:', err.message);
    }
    return { deletedCount };
  },

  async deleteByEmail(email) {
    await getDB().collection('otps').doc(otpDocKey(email)).delete().catch(() => {});
  },

  async generate(email) {
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await this.create(email, otp, Date.now() + OTP_TTL_MS);
    return otp;
  },

  // Transactional verify + mark-used. Returns true exactly once per issued code.
  async verify(email, otp) {
    if (!email || !otp) return false;
    const firestore = getDB();
    const cleanEmail = otpDocKey(email);
    const codeHash = hashOtp(String(otp).trim());
    const ref = firestore.collection('otps').doc(cleanEmail);
    let outcome = false;
    try {
      await firestore.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        if (!doc.exists) return;
        const data = doc.data();
        if (data.used === 1) return;
        if (new Date(data.expires_at).getTime() < Date.now()) return;
        if (data.otp_hash !== codeHash) {
          tx.update(ref, { attempts: FieldValue.increment(1) });
          return;
        }
        tx.update(ref, { used: 1, used_at: new Date().toISOString() });
        outcome = true;
      });
    } catch (err) {
      console.error('otpOps.verify error:', err.message);
      return false;
    }
    return outcome;
  }
};

// ===== Single-use signed link tokens (email verification & password reset) =====
// The token sent in the email is the existing stateless HMAC
// (base64url(email:expiry:hmac)). To make it single-use we ALSO persist a hash
// of the token, keyed by the hash itself for O(1) lookup (no query/index
// needed). consume() marks the token used inside a Firestore transaction, so
// two concurrent replays of the same link cannot both succeed.
const authTokenOps = {
  async create(email, token, ttlMs = 60 * 60 * 1000) {
    const firestore = getDB();
    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
    await firestore.collection('auth_tokens').doc(tokenHash).set({
      email: String(email).toLowerCase().trim(),
      token_hash: tokenHash,
      used: 0,
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
      created_at: new Date().toISOString()
    });
    return tokenHash;
  },

  // Atomically validate the token and mark it used. Returns true exactly once
  // per issued token — any later (or concurrent) replay returns false.
  async consume(email, token) {
    if (!email || !token) return false;
    const firestore = getDB();
    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const ref = firestore.collection('auth_tokens').doc(tokenHash);
    let outcome = false;
    try {
      await firestore.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        if (!doc.exists) return;
        const data = doc.data();
        if (String(data.email || '').toLowerCase().trim() !== String(email).toLowerCase().trim()) return;
        if (data.used === 1) return;
        if (new Date(data.expires_at).getTime() < Date.now()) return;
        tx.update(ref, { used: 1, used_at: new Date().toISOString() });
        outcome = true;
      });
    } catch (err) {
      console.error('authTokenOps.consume error:', err.message);
      return false;
    }
    return outcome;
  },

  async cleanExpired() {
    const firestore = getDB();
    const now = new Date().toISOString();
    let deletedCount = 0;
    try {
      const snapshot = await firestore.collection('auth_tokens')
        .where('expires_at', '<', now)
        .limit(200)
        .get();
      const batch = firestore.batch();
      let count = 0;
      snapshot.forEach(doc => { batch.delete(doc.ref); count++; });
      if (count > 0) await batch.commit();
      deletedCount += count;

      // Also sweep already-redeemed tokens (bounded, incremental).
      const usedSnapshot = await firestore.collection('auth_tokens')
        .where('used', '==', 1)
        .limit(100)
        .get();
      const usedBatch = firestore.batch();
      let usedCount = 0;
      usedSnapshot.forEach(doc => { usedBatch.delete(doc.ref); usedCount++; });
      if (usedCount > 0) await usedBatch.commit();
      deletedCount += usedCount;
    } catch (err) {
      console.error('authTokenOps.cleanExpired error:', err.message);
    }
    return { deletedCount };
  }
};

// ===== Report & Block Operations =====
const reportOps = {
  async create(reporterId, reportedUserId, reason, connectionId = null, evidence = null) {
    const firestore = getDB();
    const reportId = await getNextId('reports');
    await firestore.collection('reports').doc(String(reportId)).set({
      id: reportId,
      reporter_id: Number(reporterId),
      reported_user_id: Number(reportedUserId),
      reason: reason || 'No reason provided',
      connection_id: connectionId,
      // Reporter-supplied evidence — e.g. decrypted E2EE message content that
      // the server cannot read itself. Stored so safety review can act on it.
      evidence: evidence || null,
      status: 'pending',
      created_at: new Date().toISOString()
    });
    return reportId;
  },

  // Set of connection_ids that have at least one report within the retention window (default 30 days).
  // Used by the retention sweep so message evidence is kept longer for reported chats.
  async getConnectionIds(sinceMs = 30 * 24 * 60 * 60 * 1000) {
    const firestore = getDB();
    const cutoffIso = new Date(Date.now() - sinceMs).toISOString();
    const snapshot = await firestore.collection('reports')
      .where('created_at', '>=', cutoffIso)
      .get();
    const ids = new Set();
    snapshot.forEach(doc => {
      const connId = doc.data().connection_id;
      if (connId !== null && connId !== undefined) {
        ids.add(Number(connId));
      }
    });
    return ids;
  }
};

const blockOps = {
  async block(blockerId, blockedUserId) {
    const firestore = getDB();
    
    // Check if already blocked
    const snapshot = await firestore.collection('blocked_users')
      .where('from_user_id', '==', Number(blockerId))
      .where('to_user_id', '==', Number(blockedUserId))
      .limit(1).get();
      
    if (!snapshot.empty) return { success: true, alreadyBlocked: true };
    
    const blockId = await getNextId('blocked_users');
    await firestore.collection('blocked_users').doc(String(blockId)).set({
      id: blockId,
      from_user_id: Number(blockerId),
      to_user_id: Number(blockedUserId),
      created_at: new Date().toISOString()
    });
    
    // Also reject any active connections between them using batched writes (chunked to avoid oversized limits)
    const connections = await connectionOps.getAllBetween(blockerId, blockedUserId);
    const activeConns = connections.filter(conn => ['pending', 'accepted'].includes(conn.status));

    if (activeConns.length > 0) {
      const BATCH_LIMIT = 400; // Chunk threshold to stay well under Firestore 500 operations per batch
      for (let i = 0; i < activeConns.length; i += BATCH_LIMIT) {
        const chunk = activeConns.slice(i, i + BATCH_LIMIT);
        const batch = firestore.batch();
        chunk.forEach(conn => {
          batch.update(firestore.collection('connections').doc(String(conn.id)), {
            status: 'rejected',
            ended_reason: CONNECTION_END_REASONS.BLOCKED
          });
          if (conn.status === 'accepted') {
            batch.delete(activeConnectionLockRef(conn.from_user_id));
            batch.delete(activeConnectionLockRef(conn.to_user_id));
          }
        });
        await updateConnections(chunk.map(conn => conn.id), () => batch.commit());
      }
    }

    return { success: true, endedConnectionIds: activeConns.map(conn => conn.id) };
  },

  async unblock(blockerId, blockedUserId) {
    const firestore = getDB();
    const snapshot = await firestore.collection('blocked_users')
      .where('from_user_id', '==', Number(blockerId))
      .where('to_user_id', '==', Number(blockedUserId))
      .limit(1).get();
    if (!snapshot.empty) {
      await snapshot.docs[0].ref.delete();
    }
    return { success: true };
  },

  async isBlocked(userId1, userId2) {
    const firestore = getDB();
    const snap1 = await firestore.collection('blocked_users')
      .where('from_user_id', '==', Number(userId1))
      .where('to_user_id', '==', Number(userId2))
      .limit(1).get();
    const snap2 = await firestore.collection('blocked_users')
      .where('from_user_id', '==', Number(userId2))
      .where('to_user_id', '==', Number(userId1))
      .limit(1).get();
    return !snap1.empty || !snap2.empty;
  }
};

// Generate a random video-room slug (xxx-xxxx-xxx format) used as the last-resort
// fallback room name when no meeting provider is configured.
function generateMeetingCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const p1 = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const p2 = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const p3 = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${p1}-${p2}-${p3}`;
}

// Create a meeting-room URL for the mutual Day-10 face reveal.
//
// Provider priority:
//   1. Daily.co (REST API, browser-based, no login or app install, reliable
//      where the public Jitsi instance is blocked) — requires DAILY_API_KEY.
//   2. MEET_BASE_URL — your own self-hosted meet server (e.g. Jitsi on the
//      Oracle Always Free VM). The free-forever option: unlimited minutes, no
//      provider dependency, rooms live on your own domain.
//   3. The public Jitsi instance as a last resort so the feature never breaks.
async function createMeetingRoom() {
  const roomName = `delulu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const apiKey = process.env.DAILY_API_KEY || '';
  if (apiKey) {
    try {
      const res = await fetch('https://api.daily.co/v1/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          name: roomName,
          properties: {
            exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // room auto-expires after 24h
            enable_prejoin_ui: true,
            enable_screenshare: true,
            start_video_off: false,
            start_audio_off: false
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.url) return data.url;
        console.error('[Meet] Daily room created but the response contained no URL.');
      } else {
        console.error(`[Meet] Daily room creation failed (HTTP ${res.status}) — falling back to Jitsi.`);
      }
    } catch (err) {
      console.error(`[Meet] Daily room creation error — falling back to Jitsi: ${err.message}`);
    }
  }
  const meetBase = normalizeMeetBaseUrl(process.env.MEET_BASE_URL || '');
  if (meetBase) {
    return `${meetBase}/Delulu-Meet-${generateMeetingCode()}`;
  }
  return `https://meet.jit.si/Delulu-Meet-${generateMeetingCode()}`;
}

// Normalize an operator-supplied MEET_BASE_URL ("meet.example.com",
// "https://meet.example.com/", "https://meet.example.com") into a clean
// "https://meet.example.com" origin. Returns '' for empty or malformed input.
function normalizeMeetBaseUrl(raw) {
  if (!raw) return '';
  const s = String(raw).trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!s || !/^[a-zA-Z0-9.-]+(:[0-9]+)?(\/[a-zA-Z0-9._~-]*)*$/.test(s)) return '';
  return `https://${s}`;
}

// ===== Push Subscription Operations =====
const MAX_FCM_TOKENS_PER_USER = 5;

const pushOps = {
  // maxPerUser caps how many subscriptions a single user may hold — old entries
  // are evicted oldest-first so registration always succeeds.
  async subscribe(userId, subscription, maxPerUser = 5) {
    const firestore = getDB();
    const snapshot = await firestore.collection('push_subs')
      .where('user_id', '==', Number(userId))
      .get();
    let existing = null;
    snapshot.forEach(doc => {
      if (doc.data().endpoint === subscription.endpoint) existing = doc;
    });
    if (existing) {
      await existing.ref.update({ keys: subscription.keys, created_at: new Date().toISOString() });
      return existing.id;
    }
    // Evict oldest entries when the per-user cap is exceeded.
    const docs = snapshot.docs.slice().sort((a, b) => {
      return String(a.data().created_at || '').localeCompare(String(b.data().created_at || ''));
    });
    while (docs.length >= maxPerUser) {
      const oldest = docs.shift();
      await oldest.ref.delete().catch(() => {});
    }
    const subId = await getNextId('push_subs');
    await firestore.collection('push_subs').doc(String(subId)).set({
      id: subId,
      user_id: Number(userId),
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      created_at: new Date().toISOString()
    });
    return subId;
  },

  async getSubscriptions(userId) {
    const firestore = getDB();
    const snapshot = await firestore.collection('push_subs')
      .where('user_id', '==', Number(userId))
      .get();
    const subs = [];
    snapshot.forEach(doc => subs.push(doc.data()));
    return subs;
  },

  // Deletion is scoped by user_id so one user can never remove another user's
  // subscription just by knowing its endpoint.
  async removeSubscription(endpoint, userId = null) {
    const firestore = getDB();
    let query = firestore.collection('push_subs').where('endpoint', '==', endpoint);
    if (userId) query = query.where('user_id', '==', Number(userId));
    const snapshot = await query.limit(10).get();
    const batch = firestore.batch();
    let count = 0;
    snapshot.forEach(doc => { batch.delete(doc.ref); count++; });
    if (count > 0) await batch.commit();
  },

  async saveFCMToken(userId, fcmToken) {
    if (!fcmToken) return;
    const firestore = getDB();
    const userRef = firestore.collection('users').doc(String(userId));
    const doc = await userRef.get();
    if (doc.exists) {
      let existingTokens = doc.data().fcm_tokens || [];
      if (!Array.isArray(existingTokens)) existingTokens = [];
      if (!existingTokens.includes(fcmToken)) {
        existingTokens.push(fcmToken);
        // Cap the array so a single account cannot accumulate unbounded tokens.
        if (existingTokens.length > MAX_FCM_TOKENS_PER_USER) {
          existingTokens = existingTokens.slice(existingTokens.length - MAX_FCM_TOKENS_PER_USER);
        }
        await userRef.update({ fcm_tokens: existingTokens });
      }
    }
  },

  async getFCMTokens(userId) {
    const firestore = getDB();
    const userRef = firestore.collection('users').doc(String(userId));
    const doc = await userRef.get();
    if (doc.exists) {
      return doc.data().fcm_tokens || [];
    }
    return [];
  },

  async removeFCMToken(userId, fcmToken) {
    if (!fcmToken) return;
    const firestore = getDB();
    const userRef = firestore.collection('users').doc(String(userId));
    await userRef.update({
      fcm_tokens: FieldValue.arrayRemove(fcmToken)
    }).catch(() => {});
  }
};

// ===== Connection Sweep for Ghost Prevention =====
connectionOps.sweepExpiredRequests = async function() {
  const firestore = getDB();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let totalExpired = 0;
  
  while (true) {
    const snapshot = await firestore.collection('connections')
      .where('status', '==', 'pending')
      .limit(500)
      .get();
    
    if (snapshot.empty) break;

    const expiredDocs = [];
    snapshot.forEach(doc => {
      if (doc.data().created_at < cutoff) expiredDocs.push(doc);
    });

    if (expiredDocs.length === 0) break;

    const batch = firestore.batch();
    expiredDocs.forEach(doc => {
      batch.update(doc.ref, { status: 'expired', ended_reason: CONNECTION_END_REASONS.REQUEST_TIMEOUT });
    });

    await updateConnections(expiredDocs.map(doc => doc.data().id), () => batch.commit());
    totalExpired += expiredDocs.length;
    if (snapshot.size < 500) break;
  }
  
  return { expiredCount: totalExpired };
};

connectionOps.getAllBetween = async function(userId1, userId2) {
  const firestore = getDB();
  const snap1 = await firestore.collection('connections')
    .where('from_user_id', '==', Number(userId1))
    .where('to_user_id', '==', Number(userId2))
    .get();
  const snap2 = await firestore.collection('connections')
    .where('from_user_id', '==', Number(userId2))
    .where('to_user_id', '==', Number(userId1))
    .get();
  const results = [];
  snap1.forEach(doc => results.push(doc.data()));
  snap2.forEach(doc => results.push(doc.data()));
  return results;
};

module.exports = {
  getDB,
  getEcosystem,
  seedDemoUsers,
  userOps,
  connectionOps,
  messageOps,
  otpOps,
  authTokenOps,
  invalidateUserCache,
  reportOps,
  blockOps,
  pushOps,
  createMeetingRoom,
  normalizeMeetBaseUrl
};
