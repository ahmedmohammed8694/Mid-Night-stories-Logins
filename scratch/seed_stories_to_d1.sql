-- seed_stories_to_d1.sql
PRAGMA foreign_keys = OFF;

DELETE FROM likes;
DELETE FROM comments;
DELETE FROM stories;
DELETE FROM users;

INSERT OR IGNORE INTO stories (id, user_id, title, content, category_id, image_url, status, submitter_token, ip_hash, like_count, comment_count, created_at, updated_at) VALUES (1, NULL, 'The Day I Finally Let Go', 'For years, I carried the weight of something that happened in my childhood. I never told anyone — not my closest friend, not my partner, nobody. I thought if I buried it deep enough, it would just dissolve. But it didn''t. It grew roots.

One ordinary Tuesday, sitting in traffic, I started crying. Not the quiet kind. The kind where your whole body shakes. And for the first time, I didn''t fight it. I let every wave crash.

That was three years ago. I''m not "fixed" — I don''t think that''s the right word. But I''m lighter. I started therapy. I started this slow, awkward process of talking about what happened. And you know what surprised me most? The world didn''t end when I said it out loud.

If you''re holding something that feels too heavy to share — I see you. You don''t have to carry it alone forever.', 7, NULL, 'approved', '986aeb9e-301d-483c-9f3d-cd5aecfb8ca1', 'seed-data', 47, 3, '2026-07-12 10:23:15', '2026-07-12 10:23:15');
INSERT OR IGNORE INTO stories (id, user_id, title, content, category_id, image_url, status, submitter_token, ip_hash, like_count, comment_count, created_at, updated_at) VALUES (2, NULL, 'Growing Up in a House of Silence', 'My parents never yelled. They never hit. From the outside, our house probably looked perfect. But inside, there was this suffocating silence. Nobody talked about feelings. Nobody asked if you were okay. If you cried, you were told to go to your room until you "calmed down."

I learned to become invisible. I learned that needing help was weakness. I learned that love was something you earned by being quiet and easy.

It took me until my 30s to realize that emotional neglect is real, that what I experienced had a name, and that it explained so much — why I couldn''t ask for help, why I felt like a burden, why I apologized for existing.

I''m unlearning now. It''s messy. Some days I still automatically go silent when I''m hurt. But I''m trying.', 1, NULL, 'approved', '60cff91c-132c-4efc-b754-e7924a80d958', 'seed-data', 63, 2, '2026-07-12 10:23:15', '2026-07-12 10:23:15');
INSERT OR IGNORE INTO stories (id, user_id, title, content, category_id, image_url, status, submitter_token, ip_hash, like_count, comment_count, created_at, updated_at) VALUES (3, NULL, 'A Letter to My Younger Self', 'Hey kid,

I know right now everything feels impossible. I know you think you''re the only person in the world who feels this way. You''re not.

I won''t spoil everything, but I want you to know: it gets different. Not perfect — different. You''ll find people who actually listen. You''ll discover that the thing you''re most ashamed of? Other people have been through it too. And they''ll look at you with understanding, not disgust.

You''ll learn that being vulnerable doesn''t make you weak. It makes you real. And real is something a lot of people in this world are hungry for.

Keep going. Not because I can promise a fairy tale ending, but because the chapters ahead are worth reading.

With love,
You, twenty years from now', 4, NULL, 'approved', '2c3b020d-125c-401f-838c-edc8fb05ed15', 'seed-data', 91, 4, '2026-07-12 10:23:15', '2026-07-12 10:23:15');
INSERT OR IGNORE INTO stories (id, user_id, title, content, category_id, image_url, status, submitter_token, ip_hash, like_count, comment_count, created_at, updated_at) VALUES (4, NULL, 'The Weight of a Secret Marriage', 'I married someone from a different cultural background, and we kept it secret from both our families for two years. Two years of lies, separate holidays, coded phone calls, and this constant low-level terror of being found out.

When we finally told our families, the fallout was exactly what we feared. Some doors closed. Some relationships broke. My mother didn''t speak to me for six months.

But here''s the thing nobody tells you about choosing your own path: the relief is extraordinary. Not the absence of consequences — those are real and painful. But the relief of not performing a version of yourself anymore. Of not living inside a lie.

We''re four years in now. My mom came to dinner last month. It was awkward and imperfect. But it was real. And I''d choose real over easy every single time.', 5, NULL, 'approved', 'e04a06d4-bc2f-4812-99cf-8cb553a89dea', 'seed-data', 38, 2, '2026-07-12 10:23:15', '2026-07-12 10:23:15');
INSERT OR IGNORE INTO stories (id, user_id, title, content, category_id, image_url, status, submitter_token, ip_hash, like_count, comment_count, created_at, updated_at) VALUES (5, NULL, 'What Losing My Job Taught Me About Identity', 'When I got laid off, people said things like "it''s just a job" and "something better will come along." They meant well. But they didn''t understand — it wasn''t just a job. It was who I was.

I had built my entire identity around being productive, successful, needed. Without that title and that inbox full of urgent emails, I didn''t know who I was. Literally. I''d sit in coffee shops and think: who am I if I''m not useful?

The six months of unemployment that followed were some of the darkest of my life. But somewhere in that darkness, I found something I hadn''t expected: me. Not the LinkedIn version. Not the "what do you do?" party answer. Just me.

I learned to cook. I spent time with my aging father. I read books that had nothing to do with self-improvement. I started volunteering at a food bank — not to put it on a resume, but because it felt right.

I have a new job now. It''s fine. But I no longer let it be my whole identity. That''s the gift the worst year of my life gave me.', 6, NULL, 'approved', 'dadbd21f-ac9f-4eab-8906-ef5087b020cf', 'seed-data', 55, 3, '2026-07-12 10:23:15', '2026-07-12 10:23:15');
INSERT OR IGNORE INTO comments (id, story_id, user_id, content, status, ip_hash, created_at) VALUES (1, 1, NULL, 'This resonates so deeply. Thank you for sharing.', 'approved', 'seed-data', '2026-07-12 10:23:15');
INSERT OR IGNORE INTO comments (id, story_id, user_id, content, status, ip_hash, created_at) VALUES (2, 1, NULL, 'I had my "Tuesday" moment last month. Sending you strength.', 'approved', 'seed-data', '2026-07-12 10:23:15');
INSERT OR IGNORE INTO comments (id, story_id, user_id, content, status, ip_hash, created_at) VALUES (3, 1, NULL, 'The part about the world not ending — that hit me hard. Thank you.', 'approved', 'seed-data', '2026-07-12 10:23:15');
INSERT OR IGNORE INTO comments (id, story_id, user_id, content, status, ip_hash, created_at) VALUES (4, 2, NULL, 'I could have written this. The "apologizing for existing" part — exactly.', 'approved', 'seed-data', '2026-07-12 10:23:15');
INSERT OR IGNORE INTO comments (id, story_id, user_id, content, status, ip_hash, created_at) VALUES (5, 2, NULL, 'Emotional neglect is so invisible. Thank you for giving it words.', 'approved', 'seed-data', '2026-07-12 10:23:15');
INSERT OR IGNORE INTO comments (id, story_id, user_id, content, status, ip_hash, created_at) VALUES (6, 3, NULL, 'I needed this today. More than you know.', 'approved', 'seed-data', '2026-07-12 10:23:15');
INSERT OR IGNORE INTO comments (id, story_id, user_id, content, status, ip_hash, created_at) VALUES (7, 3, NULL, 'Writing letters to my younger self has been part of my therapy. It works.', 'approved', 'seed-data', '2026-07-12 10:23:15');
INSERT OR IGNORE INTO comments (id, story_id, user_id, content, status, ip_hash, created_at) VALUES (8, 3, NULL, '"Real is something people are hungry for" — beautiful.', 'approved', 'seed-data', '2026-07-12 10:23:15');
INSERT OR IGNORE INTO comments (id, story_id, user_id, content, status, ip_hash, created_at) VALUES (9, 3, NULL, 'Thank you. Just... thank you.', 'approved', 'seed-data', '2026-07-12 10:23:15');
INSERT OR IGNORE INTO comments (id, story_id, user_id, content, status, ip_hash, created_at) VALUES (10, 4, NULL, 'Living authentically despite the cost — this takes real courage.', 'approved', 'seed-data', '2026-07-12 10:23:15');
INSERT OR IGNORE INTO comments (id, story_id, user_id, content, status, ip_hash, created_at) VALUES (11, 4, NULL, 'I''m in a similar situation right now. This gives me hope.', 'approved', 'seed-data', '2026-07-12 10:23:15');
INSERT OR IGNORE INTO comments (id, story_id, user_id, content, status, ip_hash, created_at) VALUES (12, 5, NULL, 'The "who am I if I''m not useful" question — that''s the one that kept me up at night too.', 'approved', 'seed-data', '2026-07-12 10:23:15');
INSERT OR IGNORE INTO comments (id, story_id, user_id, content, status, ip_hash, created_at) VALUES (13, 5, NULL, 'This is beautiful. Thank you for sharing your journey.', 'approved', 'seed-data', '2026-07-12 10:23:15');
INSERT OR IGNORE INTO comments (id, story_id, user_id, content, status, ip_hash, created_at) VALUES (14, 5, NULL, 'Going through this right now. Thank you for the reminder that it gets different.', 'approved', 'seed-data', '2026-07-12 10:23:15');

PRAGMA foreign_keys = ON;