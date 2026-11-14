import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { buildDeterministicMatchupAnalysis } from '../../../src/utils/heroMatchup.ts';
import { buildDeterministicProTips } from '../../../src/utils/comboEngine.ts';

export type AiPayload = {
  heroId?: number;
  heroName?: string;
  rankTier?: string;
  roles?: string[];
  lanes?: string[];
  speciality?: string[];
  winRatePct?: number | null;
  pickRatePct?: number | null;
  banRatePct?: number | null;
  strongAgainst?: Array<{ name: string; winRateBoostPct: number }>;
  bestTeammates?: Array<{ name: string; winRateBoostPct: number }>;
  skills?: Array<{ slot?: string; name: string; cooldownCost?: string; summary: string }>;
  counterItems?: Array<{ equipName: string; typeLabel: string; reason: string }>;
};

type Env = { GEMINI_API_KEY?: string };

const cache = new Map<string, { expiresAt: number; value: unknown }>();
const CACHE_MS = 600_000;

function fallbackMatchup(payload: AiPayload) {
  return buildDeterministicMatchupAnalysis({
    heroName: payload.heroName!,
    rankTier: payload.rankTier,
    roles: payload.roles,
    winRatePct: payload.winRatePct,
    banRatePct: payload.banRatePct,
    strongAgainst: payload.strongAgainst,
    bestTeammates: payload.bestTeammates,
    skills: payload.skills,
    counterItems: payload.counterItems,
  });
}

function fallbackProTips(payload: AiPayload) {
  return buildDeterministicProTips({
    heroName: payload.heroName!,
    rankTier: payload.rankTier,
    roles: payload.roles,
    lanes: payload.lanes,
    speciality: payload.speciality,
    winRatePct: payload.winRatePct,
    strongAgainst: payload.strongAgainst,
    bestTeammates: payload.bestTeammates,
    skills: payload.skills,
  });
}

function client(env: Env) {
  const key = env.GEMINI_API_KEY?.trim();
  return key
    ? new GoogleGenAI({
        apiKey: key,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      })
    : null;
}

export async function matchup(payload: AiPayload, env: Env, forceRefresh = false) {
  const key = `matchup:${payload.heroId}:${payload.rankTier || 'mythic'}`;
  if (!forceRefresh) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return { analysis: cached.value, cached: true };
  }

  const ai = client(env);
  if (!ai) return { analysis: fallbackMatchup(payload), cached: false, fallback: true };

  const promptText = [
    `Target Hero: ${payload.heroName} (${payload.roles?.join(' / ') || 'Unknown Role'}; Lanes: ${payload.lanes?.join(', ') || 'Flex'}; Specialty: ${payload.speciality?.join(', ') || 'N/A'})`,
    `Ranked Tier (${payload.rankTier || 'mythic'}): Win Rate ${payload.winRatePct ?? 'N/A'}%, Pick Rate ${payload.pickRatePct ?? 'N/A'}%, Ban Rate ${payload.banRatePct ?? 'N/A'}%`,
    `Heroes ${payload.heroName} Performs Best Against (Win Rate Boost): ${payload.strongAgainst?.length ? payload.strongAgainst.map(s => `${s.name} (+${s.winRateBoostPct}%)`).join(', ') : 'None recorded'}`,
    `Top Teammate Synergies: ${payload.bestTeammates?.length ? payload.bestTeammates.map(t => `${t.name} (+${t.winRateBoostPct}%)`).join(', ') : 'None recorded'}`,
    `Skill Kit Summary: ${payload.skills?.length ? payload.skills.map(k => `${k.name}: ${k.summary}`).join(' | ') : 'Not provided'}`,
    `Recommended MLBB Counter Items Against ${payload.heroName}: ${payload.counterItems?.length ? payload.counterItems.map(i => `${i.equipName} (${i.typeLabel} — ${i.reason})`).join(' | ') : 'General defensive items'}`,
    `Provide a concise, high-signal tactical Matchup Analysis explaining how to play and itemize against ${payload.heroName}.`,
  ].join('\n');

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: promptText,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        systemInstruction: 'You are a Mythical Immortal Mobile Legends: Bang Bang (MLBB) coach. Summarize the best strategies to counter the target hero based strictly on their win rates, skill windows, matchup synergies, and counter-items. Keep the overview to 2 concise sentences, give exactly 3 sharp counter strategies (under 24 words each), give 3 item build recommendations referencing the provided MLBB counter items, and end with a 1-sentence draft verdict.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overview: { type: Type.STRING },
            counterStrategies: { type: Type.ARRAY, items: { type: Type.STRING } },
            itemBuildAdvice: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: { itemName: { type: Type.STRING }, reason: { type: Type.STRING } },
                required: ['itemName', 'reason'],
              },
            },
            draftVerdict: { type: Type.STRING },
          },
          required: ['overview', 'counterStrategies', 'itemBuildAdvice', 'draftVerdict'],
        },
      },
    });
    const raw = (response.text ?? '').trim();
    const analysis = JSON.parse(raw);
    cache.set(key, { expiresAt: Date.now() + CACHE_MS, value: analysis });
    return { analysis, cached: false };
  } catch {
    return { analysis: fallbackMatchup(payload), cached: false, fallback: true };
  }
}

export async function proTips(payload: AiPayload, env: Env, forceRefresh = false) {
  const key = `protips:${payload.heroId}:${payload.rankTier || 'mythic'}`;
  if (!forceRefresh) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return { proTips: cached.value, cached: true };
  }

  const ai = client(env);
  if (!ai) return { proTips: fallbackProTips(payload), cached: false, fallback: true };

  const promptText = [
    `Hero: ${payload.heroName} (${payload.roles?.join(' / ') || 'Unknown Role'}; Lanes: ${payload.lanes?.join(', ') || 'Flex'}; Specialty: ${payload.speciality?.join(', ') || 'N/A'})`,
    `Ranked Meta (${payload.rankTier || 'mythic'}): Win Rate ${payload.winRatePct ?? 'N/A'}%, Pick Rate ${payload.pickRatePct ?? 'N/A'}%, Ban Rate ${payload.banRatePct ?? 'N/A'}%`,
    `Ability Kit:\n${payload.skills?.length ? payload.skills.map(k => `- [${k.slot || 'Skill'}] ${k.name}${k.cooldownCost ? ` (${k.cooldownCost})` : ''}: ${k.summary}`).join('\n') : '- Skill data unavailable'}`,
    `Strong Against (Win Rate Boost): ${payload.strongAgainst?.length ? payload.strongAgainst.map(s => `${s.name} (+${s.winRateBoostPct}%)`).join(', ') : 'None recorded'}`,
    `Best Allied Synergies: ${payload.bestTeammates?.length ? payload.bestTeammates.map(t => `${t.name} (+${t.winRateBoostPct}%)`).join(', ') : 'None recorded'}`,
    `Parse this hero's meta data and skill kit into high-elo Pro Tips for PLAYING ${payload.heroName}, covering ability leveling priority, 2-3 recommended skill combos with step sequences, execution tips, teamfight positioning, and power spikes.`,
  ].join('\n');

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: promptText,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        systemInstruction: 'You are a Mythical Immortal Mobile Legends: Bang Bang (MLBB) coach teaching a player how to pilot the specified hero effectively. Ground your advice in the provided skill names, cooldowns, ranked win rates, and best teammate synergies. Return concise, practical guidance: a 2-sentence playstyle summary, an explicit ability leveling order label (e.g. "Ult > Skill 1 > Skill 2") with 3 skill priority notes, 2-3 concrete recommended skill combos (with ordered step sequence using slots like "Skill 1", "Skill 2", "Ult", "Basic Attack", "Flicker" and brief skill labels + whenToUse), 3 sharp execution/laning tips, clear teamfight positioning guidance, and a 2-sentence power spike & macro note.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            playstyleSummary: { type: Type.STRING },
            skillPriority: {
              type: Type.OBJECT,
              properties: {
                orderLabel: { type: Type.STRING },
                skillsToPrioritize: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: { slot: { type: Type.STRING }, skillName: { type: Type.STRING }, reason: { type: Type.STRING } },
                    required: ['slot', 'skillName', 'reason'],
                  },
                },
              },
              required: ['orderLabel', 'skillsToPrioritize'],
            },
            recommendedCombos: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  sequence: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: { slot: { type: Type.STRING }, label: { type: Type.STRING } },
                      required: ['slot', 'label'],
                    },
                  },
                  whenToUse: { type: Type.STRING },
                },
                required: ['title', 'sequence', 'whenToUse'],
              },
            },
            comboAndExecution: { type: Type.ARRAY, items: { type: Type.STRING } },
            teamfightPositioning: { type: Type.STRING },
            powerSpikesAndMacro: { type: Type.STRING },
          },
          required: ['playstyleSummary', 'skillPriority', 'recommendedCombos', 'comboAndExecution', 'teamfightPositioning', 'powerSpikesAndMacro'],
        },
      },
    });
    const raw = (response.text ?? '').trim();
    const tips = JSON.parse(raw);
    cache.set(key, { expiresAt: Date.now() + CACHE_MS, value: tips });
    return { proTips: tips, cached: false };
  } catch {
    return { proTips: fallbackProTips(payload), cached: false, fallback: true };
  }
}
