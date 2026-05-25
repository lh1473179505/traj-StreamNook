// commandPaletteCopypastas — curated long-form copypasta library for the
// Ctrl+K palette's 'Snippets' section. Hand-picked from well-known Twitch
// chat culture (and adjacent internet folklore). Coverage targets evergreen,
// chat-safe humor — no slurs, no sexual content, nothing that requires the
// reader to be in a specific tribe to get the joke.
//
// Each snippet has:
//   - a short display `title` (what appears in the palette row),
//   - a `category` (drives grouping + keyword matching),
//   - the actual `content` that gets copied to the clipboard on select,
//   - optional `keywords` for aliases the matcher should accept.
//
// **To add a snippet**: append to the array. Keep IDs stable — the snippet
// store uses them to key favorites and aliases. If you remove a built-in
// snippet, anyone who favorited or aliased it will silently lose that data;
// prefer marking obsolete ones with a "(removed)" suffix on the title until
// next major bump.
//
// Bundle cost note: inline template literals here are visible to the bundler.
// At ~80 entries the file weighs about 18 KB raw / 7 KB gzipped — small
// enough that lazy-loading isn't worth the complexity.

export interface Snippet {
  id: string;
  title: string;
  category: 'Classic' | 'Hype' | 'Reaction' | 'F / RIP' | 'Forsen Lore' | 'Long Classic' | 'Meme' | 'Chat Commands';
  content: string;
  keywords?: string;
}

const SNIPPETS: Snippet[] = [
  // ---- Classic (short, iconic) -----------------------------------------
  {
    id: 'doritos-pope',
    title: 'Doritos & Mountain Dew',
    category: 'Classic',
    content: "Doritos & Mountain Dew? In MY gamer house? It's more likely than you think.",
  },
  {
    id: 'guy-fieri',
    title: 'Welcome to Flavortown',
    category: 'Classic',
    content: 'Welcome to Flavortown, population: this chat.',
  },
  {
    id: 'low-tier-god',
    title: 'You are everything wrong with this chat',
    category: 'Classic',
    content: "You are everything that's wrong with this chat. You are a sub-human. You don't deserve to be here.",
  },
  {
    id: 'ok-boomer',
    title: 'OK Boomer',
    category: 'Classic',
    content: 'OK Boomer',
  },
  {
    id: 'thanks-doc',
    title: 'Thanks Doc',
    category: 'Classic',
    content: 'thanks doc',
    keywords: 'dr disrespect',
  },
  {
    id: 'doctor-says',
    title: "Doctor says I have a bad case of yikes",
    category: 'Classic',
    content: 'doctor says I have a bad case of the yikes',
  },
  {
    id: 'salt-supreme',
    title: 'Salt Supreme',
    category: 'Classic',
    content: 'I would like to subscribe to your salt newsletter',
  },
  {
    id: 'i-have-questions',
    title: 'I have so many questions',
    category: 'Classic',
    content: 'I have so many questions, and so few of them are appropriate.',
  },

  // ---- Hype (spam / let's go) ------------------------------------------
  { id: 'lets-go', title: "LET'S GOOOO", category: 'Hype', content: "LET'S GOOOOOOOOOO" },
  { id: 'pog-spam', title: 'POGGERS spam', category: 'Hype', content: 'POGGERS POGGERS POGGERS POGGERS POGGERS' },
  { id: 'w-stream', title: 'W stream', category: 'Hype', content: 'W stream' },
  { id: 'l-stream', title: 'L stream', category: 'F / RIP', content: 'L stream' },
  { id: 'absolute-cinema', title: 'Absolute cinema', category: 'Hype', content: 'Absolute cinema 🍿' },
  { id: 'tuned-in', title: 'TUNED IN. LOCKED IN.', category: 'Hype', content: 'TUNED IN. LOCKED IN. CAPS LOCKED IN.' },
  { id: 'clip-it', title: 'CLIP IT', category: 'Hype', content: 'CLIP IT CLIP IT CLIP IT CLIP IT' },
  { id: 'goated', title: 'GOATED with the sauce', category: 'Hype', content: 'GOATED with the sauce 🐐' },
  { id: 'cooking', title: 'HE IS COOKING', category: 'Hype', content: 'HE IS COOKING 👨‍🍳🔥' },
  {
    id: 'every-time',
    title: 'EVERY TIME',
    category: 'Hype',
    content: 'EVERY TIME. EVERY SINGLE TIME. THIS GUY DOES NOT MISS.',
  },
  {
    id: 'oh-my-god',
    title: "OH MY GOD HE'S DOING IT",
    category: 'Hype',
    content: "OH MY GOD HE'S DOING IT. HE'S ACTUALLY DOING IT.",
  },
  {
    id: 'standing-ovation',
    title: 'Standing ovation',
    category: 'Hype',
    content: '👏 standing 👏 ovation 👏',
  },
  {
    id: 'chefs-kiss',
    title: "Chef's kiss",
    category: 'Hype',
    content: '🤌 magnifique 🤌',
  },
  {
    id: 'lock-the-thread',
    title: 'Lock the thread',
    category: 'Hype',
    content: 'lock the thread, we found the best one',
  },
  {
    id: 'down-bad',
    title: 'Down bad',
    category: 'Hype',
    content: 'down BAD for this chat right now',
  },

  // ---- Reaction --------------------------------------------------------
  { id: 'omegalul', title: 'OMEGALUL', category: 'Reaction', content: 'OMEGALUL OMEGALUL OMEGALUL' },
  { id: 'lulw', title: 'LULW', category: 'Reaction', content: 'LULW LULW LULW' },
  { id: 'sadge', title: 'Sadge', category: 'Reaction', content: 'Sadge 😔' },
  { id: 'pepega', title: 'Pepega', category: 'Reaction', content: 'Pepega Clap 👏' },
  { id: 'monkas', title: 'monkaS', category: 'Reaction', content: 'monkaS monkaS monkaS' },
  { id: 'copium', title: 'COPIUM', category: 'Reaction', content: 'COPIUM' },
  { id: 'hopium', title: 'HOPIUM', category: 'Reaction', content: 'HOPIUM' },
  { id: 'no-way', title: 'NO WAY', category: 'Reaction', content: 'NO WAY 😱' },
  { id: 'aware', title: 'aware', category: 'Forsen Lore', keywords: 'forsen', content: 'aware' },
  { id: 'plot-twist', title: 'plot twist', category: 'Reaction', content: 'plot twist 😳' },
  { id: 'gigachad', title: 'GIGACHAD', category: 'Reaction', content: 'GIGACHAD 💪' },
  { id: 'mald', title: 'MALDING', category: 'Reaction', content: 'MALDING' },
  { id: 'sus', title: 'sus', category: 'Reaction', content: 'sus 😳' },
  { id: 'my-honest-reaction', title: 'My honest reaction', category: 'Reaction', content: 'my honest reaction:' },
  { id: 'skill-issue', title: 'Skill issue', category: 'Reaction', content: 'skill issue ngl' },
  { id: 'cope-seethe', title: 'Cope seethe mald', category: 'Reaction', content: 'cope, seethe, mald' },
  { id: 'ratio', title: 'Ratio', category: 'Reaction', content: 'ratio + L + you fell off' },
  { id: 'real-this-time', title: 'No way, for real this time', category: 'Reaction', content: 'no way 😨 for real this time 😨' },
  { id: 'i-am-here', title: 'I am here on a Tuesday night', category: 'Reaction', content: 'and yet, here I am, on a Tuesday night, in this chat' },

  // ---- F / RIP --------------------------------------------------------
  { id: 'press-f', title: 'Press F', category: 'F / RIP', keywords: 'pay respects', content: 'Press F to pay respects' },
  { id: 'big-f', title: 'F', category: 'F / RIP', content: 'F' },
  { id: 'rip-chat', title: 'RIP chat', category: 'F / RIP', content: 'RIP chat 🪦' },
  { id: 'rip-bozo', title: 'RIP bozo', category: 'F / RIP', content: 'RIP BOZO 🤡' },
  { id: 'gn-king', title: 'Goodnight sweet prince', category: 'F / RIP', content: 'goodnight sweet prince 🫡' },
  { id: 'we-lost-him', title: 'We lost him', category: 'F / RIP', content: 'we lost him chat',  },

  // ---- Forsen lore ----------------------------------------------------
  { id: 'bald-spot', title: 'bald spot', category: 'Forsen Lore', content: 'bald spot' },
  { id: 'forsen-bait', title: 'forsenBaited', category: 'Forsen Lore', content: 'forsenBaited' },
  { id: 'last-name-eee', title: 'Last name eee, first name V', category: 'Forsen Lore', content: 'last name eee, first name V' },
  { id: 'forsen-cake', title: 'It was at this moment', category: 'Forsen Lore', content: 'It was at this moment, that he knew. He f*cked up.' },
  { id: 'forsen-aware', title: 'I am aware', category: 'Forsen Lore', content: 'I am aware that you are aware that I am aware that you are aware' },
  { id: 'tea-baggers', title: 'tea baggers', category: 'Forsen Lore', content: 'tea baggers' },
  { id: 'okayeg', title: 'Okayeg', category: 'Forsen Lore', content: 'Okayeg' },

  // ---- Long Classic (the multi-paragraph staples) ----------------------
  {
    id: 'doritos-detective',
    title: 'Doritos Detective',
    category: 'Long Classic',
    keywords: 'evidence crumbs',
    content: `I have collected three pieces of evidence so far. (1) An empty bag of Doritos under his desk. (2) A trail of orange crumbs leading to the chat. (3) A faint, but unmistakable, smell of Mountain Dew in the air. Conclusion: gamer detected, opinion respectfully accepted.`,
  },
  {
    id: 'navy-seal',
    title: 'Navy Seal copypasta (cleaned)',
    category: 'Long Classic',
    keywords: 'gorilla warfare',
    content: `What the heck did you just say about me, you little noob? I'll have you know I graduated top of my class in Twitch chat, and I've been involved in numerous secret raids on Hasan's stream, and I have over 300 confirmed Pogs. I am trained in gorilla warfare and I'm the top emote spammer in the entire Twitch app. You are nothing to me but just another sub. I will wipe you the heck out with precision the likes of which has never been seen before on this platform, mark my heckin words.`,
  },
  {
    id: 'andy-bernard',
    title: 'I wish there was a way to know',
    category: 'Long Classic',
    keywords: 'the office andy bernard',
    content: `I wish there was a way to know you're in the good old days before you've actually left them.`,
  },
  {
    id: 'be-water',
    title: 'Be water my friend',
    category: 'Long Classic',
    keywords: 'bruce lee',
    content: `Empty your mind. Be formless, shapeless — like water. You put water into a cup, it becomes the cup. You put it into a teapot, it becomes the teapot. Now water can flow, or it can crash. Be water, my friend.`,
  },
  {
    id: 'totinos-line',
    title: 'Me waiting in the Totinos line',
    category: 'Long Classic',
    content: `Me waiting in the Totinos Party Line, watching this stream live, knowing full well I should be in bed by now, but also knowing that absolute cinema waits for no one.`,
  },
  {
    id: 'comrade-pasta',
    title: 'Comrade, I have found one',
    category: 'Long Classic',
    keywords: 'soviet counter revolutionary',
    content: `Comrade, I have found a counter-revolutionary in the chat. The evidence: they used a non-approved emote, complained about loading screens, and have shown three (3) signs of being a casual. Sentence: hard labor in the salt mines of /r/livestreamfail until they understand the importance of grinding for chat rep.`,
  },
  {
    id: 'fast-food-worker',
    title: 'Fast food worker copypasta',
    category: 'Long Classic',
    content: `I work the drive-thru. A car pulls up. I ask for their order. They say, "I'll have what HE'S having." I look back. The kitchen is empty. The grill is off. I have been alone in this restaurant for six hours.`,
  },
  {
    id: 'i-am-12',
    title: "I'm 12 and what is this",
    category: 'Long Classic',
    content: "I'm 12 and what is this",
  },
  {
    id: 'gamer-girl-water',
    title: 'I would buy gamer girl water',
    category: 'Long Classic',
    content: "I would buy gamer girl water at $40 a bottle if it meant I got to leave this chat one hour earlier.",
  },
  {
    id: 'chilis-greeter',
    title: "Hi welcome to Chili's",
    category: 'Long Classic',
    content: "Hi welcome to Chili's. Will it be the chat tonight, sir, or shall I get you a table by the window?",
  },
  {
    id: 'aware-aware-aware',
    title: 'AWARE pasta',
    category: 'Long Classic',
    content: `I am aware that you spam this in chat. You are aware that I am aware that you spam this in chat. I am aware that you are aware that I am aware. We are all aware. The awareness has reached critical mass.`,
  },
  {
    id: 'mom-said-its-my-turn',
    title: "Mom said it's my turn on the Twitch",
    category: 'Long Classic',
    content: "mom said it's my turn on the twitch",
  },
  {
    id: 'water-bottle-orange-juice',
    title: 'Orange juice on my desk',
    category: 'Long Classic',
    content: `I have a bottle of orange juice on my desk. Has been there since this stream started. It is now warm. I refuse to leave my chair. This stream owns me now.`,
  },
  {
    id: 'who-up-watching',
    title: 'Who up watching they stream rn',
    category: 'Long Classic',
    content: 'who up watching they stream rn',
  },
  {
    id: 'mom-gets-home',
    title: 'Mom gets home in 5 minutes',
    category: 'Long Classic',
    content: 'mom gets home in 5 minutes and the dishes still aren\'t done. AND YET I AM HERE',
  },
  {
    id: 'dad-card-pasta',
    title: 'Dad gave me the card',
    category: 'Long Classic',
    content: "Dad gave me the card to buy groceries. I bought 300 bits instead. Dad doesn't know yet. PrayBee",
  },

  // ---- Meme (internet folklore) ----------------------------------------
  { id: 'shrug', title: 'Shrug', category: 'Meme', content: '¯\\_(ツ)_/¯' },
  { id: 'flip-table', title: 'Flip table', category: 'Meme', content: '(╯°□°)╯︵ ┻━┻' },
  { id: 'put-table-back', title: 'Put the table back', category: 'Meme', content: '┬─┬ ノ( ゜-゜ノ)' },
  { id: 'lenny', title: 'Lenny face', category: 'Meme', content: '( ͡° ͜ʖ ͡°)' },
  { id: 'this-is-fine', title: 'This is fine', category: 'Meme', content: 'This is fine. 🔥🐕🔥' },
  { id: 'why-no-talk', title: 'Why are you not talking', category: 'Meme', content: 'why are you not talking' },
  { id: 'first', title: 'First', category: 'Meme', content: 'first' },
  { id: 'subbed', title: 'Just subbed!', category: 'Meme', content: 'just subbed 🎉' },
  { id: 'no-thoughts', title: 'No thoughts head empty', category: 'Meme', content: 'no thoughts head empty 🧠' },
  { id: 'rent-free', title: 'Rent free', category: 'Meme', content: 'living rent free in my head' },
  { id: 'touch-grass', title: 'Touch grass', category: 'Meme', content: 'touch grass 🌱' },
  { id: 'ratio-fell-off', title: 'You fell off', category: 'Meme', content: 'you fell off' },
  { id: 'cinemax', title: 'Cinemax tier', category: 'Meme', content: 'this is cinemax tier content' },
  { id: 'tax-fraud', title: 'Tax fraud', category: 'Meme', content: 'just committed tax fraud LULW' },
  { id: 'i-fear-no-man', title: 'I fear no man', category: 'Meme', content: 'I fear no man. But that emote… it scares me.' },
  { id: 'ad-block', title: 'Block him', category: 'Meme', content: 'block him chat, you don\'t need this in your life' },
  { id: 'reading-comprehension', title: 'Reading comprehension', category: 'Meme', content: 'this chat has the reading comprehension of a brick wall' },
  { id: 'modern-problems', title: 'Modern problems require modern solutions', category: 'Meme', content: 'modern problems require modern solutions' },
  { id: 'thanks-i-hate-it', title: 'Thanks, I hate it', category: 'Meme', content: 'thanks, I hate it' },

  // ---- Chat commands (Twitch slash; copy → paste into chat) ------------
  { id: 'cmd-shrug', title: '/me shrug', category: 'Chat Commands', keywords: 'slash me action italic', content: '/me ¯\\_(ツ)_/¯' },
  { id: 'cmd-uniquechat', title: '/uniquechat', category: 'Chat Commands', keywords: 'slash unique r9k', content: '/uniquechat' },
  { id: 'cmd-uniquechat-off', title: '/uniquechatoff', category: 'Chat Commands', content: '/uniquechatoff' },
  { id: 'cmd-emoteonly', title: '/emoteonly', category: 'Chat Commands', content: '/emoteonly' },
  { id: 'cmd-emoteonly-off', title: '/emoteonlyoff', category: 'Chat Commands', content: '/emoteonlyoff' },
  { id: 'cmd-slow', title: '/slow 30', category: 'Chat Commands', keywords: 'slash slowmode 30 seconds', content: '/slow 30' },
  { id: 'cmd-slow-off', title: '/slowoff', category: 'Chat Commands', content: '/slowoff' },
  { id: 'cmd-subscribers', title: '/subscribers', category: 'Chat Commands', content: '/subscribers' },
  { id: 'cmd-subscribers-off', title: '/subscribersoff', category: 'Chat Commands', content: '/subscribersoff' },
  { id: 'cmd-followers', title: '/followers 10m', category: 'Chat Commands', keywords: 'slash followermode', content: '/followers 10m' },
  { id: 'cmd-followers-off', title: '/followersoff', category: 'Chat Commands', content: '/followersoff' },
  { id: 'cmd-clear', title: '/clear', category: 'Chat Commands', keywords: 'clear chat wipe', content: '/clear' },
  { id: 'cmd-marker', title: '/marker', category: 'Chat Commands', keywords: 'stream marker vod chapter', content: '/marker' },
  { id: 'cmd-color', title: '/color FF0000', category: 'Chat Commands', keywords: 'slash color name red hex', content: '/color FF0000' },
  { id: 'cmd-vip', title: '/vip <user>', category: 'Chat Commands', content: '/vip ' },
  { id: 'cmd-unvip', title: '/unvip <user>', category: 'Chat Commands', content: '/unvip ' },
  { id: 'cmd-mod', title: '/mod <user>', category: 'Chat Commands', content: '/mod ' },
  { id: 'cmd-unmod', title: '/unmod <user>', category: 'Chat Commands', content: '/unmod ' },
  { id: 'cmd-timeout', title: '/timeout <user> 600', category: 'Chat Commands', keywords: 'timeout ban 10 minutes', content: '/timeout ' },
  { id: 'cmd-untimeout', title: '/untimeout <user>', category: 'Chat Commands', content: '/untimeout ' },
  { id: 'cmd-ban', title: '/ban <user>', category: 'Chat Commands', content: '/ban ' },
  { id: 'cmd-unban', title: '/unban <user>', category: 'Chat Commands', content: '/unban ' },
  { id: 'cmd-raid', title: '/raid <channel>', category: 'Chat Commands', content: '/raid ' },
  { id: 'cmd-unraid', title: '/unraid', category: 'Chat Commands', content: '/unraid' },
  { id: 'cmd-host', title: '/shoutout <user>', category: 'Chat Commands', keywords: 'host shoutout so', content: '/shoutout ' },
  { id: 'cmd-commercial', title: '/commercial 30', category: 'Chat Commands', keywords: 'ads commercial break', content: '/commercial 30' },
  { id: 'cmd-poll', title: '/poll', category: 'Chat Commands', content: '/poll' },
  { id: 'cmd-prediction', title: '/prediction', category: 'Chat Commands', content: '/prediction' },
];

export function getBuiltInSnippets(): readonly Snippet[] {
  return SNIPPETS;
}

/** Built-in snippet ids set, frozen for O(1) "is this snippet built-in?" lookups
 *  from the settings manager (which uses it to decide if a row can be deleted). */
export const BUILTIN_SNIPPET_IDS: ReadonlySet<string> = new Set(SNIPPETS.map((s) => s.id));
