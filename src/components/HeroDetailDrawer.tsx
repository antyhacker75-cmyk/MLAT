import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  fetchHeroCompatibility,
  fetchHeroCounters,
  fetchHeroDetail,
} from '../services/roneApi';
import type {
  EquipmentRecord,
  HeroDetailRecord,
  HeroRankRecord,
  RankFilter,
} from '../types/mlbb';
import { buildHeroMatchupPayload } from '../utils/heroMatchup';
import { formatPercent, stripHtmlTags, type HeroMetadataSummary } from '../utils/mlbb';
import { MatchupAnalysisSection } from './MatchupAnalysisSection';
import { ProTipsTab } from './ProTipsTab';
import { SafeImage } from './SafeImage';

interface HeroDetailDrawerProps {
  heroId: number | null;
  rankFilter: RankFilter;
  positionMap: Map<number, HeroMetadataSummary>;
  heroRankMap: Map<number, HeroRankRecord>;
  heroNameMap: Map<number, { name: string; head: string }>;
  equipmentList: EquipmentRecord[];
  onSelectHero: (heroId: number) => void;
  onClose: () => void;
}

const ABILITY_LABELS = ['Durability', 'Offense', 'Control', 'Difficulty'];

export function HeroDetailDrawer({
  heroId,
  rankFilter,
  positionMap,
  heroRankMap,
  heroNameMap,
  equipmentList,
  onSelectHero,
  onClose,
}: HeroDetailDrawerProps) {
  const [detail, setDetail] = useState<HeroDetailRecord | null>(null);
  const [counters, setCounters] = useState<HeroRankRecord | null>(null);
  const [compat, setCompat] = useState<HeroRankRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<'overview' | 'pro-tips'>('overview');

  useEffect(() => {
    if (!heroId) {
      setDrawerTab('overview');
    }
  }, [heroId]);

  useEffect(() => {
    if (!heroId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const apiRank: RankFilter = rankFilter === 'all' ? 'mythic' : rankFilter;

    Promise.all([
      fetchHeroDetail(heroId),
      fetchHeroCounters(heroId, apiRank).catch(() => null),
      fetchHeroCompatibility(heroId, apiRank).catch(() => null),
    ])
      .then(([d, c, comp]) => {
        if (cancelled) return;
        setDetail(d);
        setCounters(c);
        setCompat(comp);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Unable to load hero profile.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [heroId, rankFilter]);

  useEffect(() => {
    if (!heroId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [heroId, onClose]);

  const heroData = detail?.data?.hero?.data;
  const fallbackInfo = heroId ? heroNameMap.get(heroId) : undefined;
  const heroName = heroData?.name || fallbackInfo?.name || (heroId ? `Hero #${heroId}` : '');
  const heroPortrait = detail?.data?.head || heroData?.painting || fallbackInfo?.head;
  const pos = heroId ? positionMap.get(heroId) : undefined;
  const rankRecord = heroId ? heroRankMap.get(heroId) : undefined;
  const rankStat = rankRecord?.data;
  const skills = heroData?.heroskilllist?.[0]?.skilllist || [];
  const abilities = heroData?.abilityshow || [];

  const matchupPayload = useMemo(() => {
    if (!heroId) return null;
    return buildHeroMatchupPayload({
      heroId,
      heroName,
      rankFilter,
      pos,
      detail,
      rankRecord,
      counters,
      compat,
      heroNameMap,
      equipmentList,
    });
  }, [heroId, heroName, rankFilter, pos, detail, rankRecord, counters, compat, heroNameMap, equipmentList]);

  if (!heroId || !matchupPayload) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={`${heroName} details`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[#0D131E] border-l border-slate-800 h-full overflow-y-auto p-6 sm:p-8 space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="flex items-center gap-4">
            <SafeImage
              src={heroPortrait}
              alt={heroName}
              fallbackText={heroName}
              size="lg"
              className="w-16 h-16 rounded-xl border border-slate-700"
            />
            <div>
              <div className="text-xs text-slate-400 capitalize">
                {pos?.roles?.join(' / ') || 'Hero'}
                {pos?.lanes?.length ? ` · ${pos.lanes.join(' · ')}` : ''}
                {heroData?.speciality?.length ? ` · ${heroData.speciality.join(', ')}` : ''}
              </div>
              <h2 className="font-display text-2xl font-bold text-slate-50 mt-0.5">
                {heroName}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close hero details"
            className="p-2 rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="space-y-4">
            <div className="h-24 rounded-xl bg-slate-800/60 animate-pulse" />
            <div className="h-44 rounded-xl bg-slate-800/60 animate-pulse" />
            <div className="h-36 rounded-xl bg-slate-800/60 animate-pulse" />
          </div>
        ) : error ? (
          <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/70 text-sm text-rose-200">
            {error}
          </div>
        ) : (
          <>
            {/* Drawer View Tabs */}
            <div
              role="tablist"
              aria-label="Hero detail sections"
              className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#111827] border border-slate-800"
            >
              <button
                type="button"
                role="tab"
                aria-selected={drawerTab === 'overview'}
                onClick={() => setDrawerTab('overview')}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  drawerTab === 'overview'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-300 hover:text-slate-100 hover:bg-slate-800/70'
                }`}
              >
                Overview
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={drawerTab === 'pro-tips'}
                onClick={() => setDrawerTab('pro-tips')}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  drawerTab === 'pro-tips'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-300 hover:text-slate-100 hover:bg-slate-800/70'
                }`}
              >
                Pro Tips
              </button>
            </div>

            {drawerTab === 'pro-tips' ? (
              <ProTipsTab
                key={`pro-${heroId}-${rankFilter}`}
                payload={matchupPayload}
                skills={skills}
              />
            ) : (
              <>
                {/* Live Win/Pick/Ban strip */}
            {rankStat && (
              <div className="grid grid-cols-3 gap-4 p-4 rounded-xl border border-slate-800 bg-[#111827]">
                <div>
                  <div className="text-xs text-slate-400">Win Rate</div>
                  <div className="font-mono tabular-nums text-xl font-semibold text-emerald-400 mt-0.5">
                    {formatPercent(rankStat.main_hero_win_rate)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Pick Rate</div>
                  <div className="font-mono tabular-nums text-xl font-semibold text-slate-100 mt-0.5">
                    {formatPercent(rankStat.main_hero_appearance_rate)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Ban Rate</div>
                  <div className="font-mono tabular-nums text-xl font-semibold text-amber-300 mt-0.5">
                    {formatPercent(rankStat.main_hero_ban_rate)}
                  </div>
                </div>
              </div>
            )}

            {/* AI Matchup Analysis & Counter Strategy */}
            <MatchupAnalysisSection
              key={`${heroId}-${rankFilter}`}
              payload={matchupPayload}
              equipmentList={equipmentList}
            />

            {/* Lore & Ability Ratings */}
            {(heroData?.story || abilities.length > 0) && (
              <div className="space-y-4">
                {heroData?.story && (
                  <p className="text-sm text-slate-300 leading-relaxed">
                    {stripHtmlTags(heroData.story)}
                  </p>
                )}

                {abilities.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                    {abilities.slice(0, 4).map((val, idx) => {
                      const num = Math.min(100, Math.max(0, Number(val) || 0));
                      return (
                        <div key={ABILITY_LABELS[idx]} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-400">{ABILITY_LABELS[idx]}</span>
                            <span className="font-mono tabular-nums text-slate-200">{num}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className="h-full bg-amber-400"
                              style={{ width: `${num}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Skills Breakdown */}
            {skills.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-display text-sm font-semibold text-slate-100">
                  Skill Kit
                </h3>
                <div className="divide-y divide-slate-800/70 rounded-xl border border-slate-800 bg-[#111827]">
                  {skills.map((skill, idx) => (
                    <div key={`${skill.skillname}-${idx}`} className="p-4 flex gap-3.5">
                      <SafeImage
                        src={skill.skillicon}
                        alt={skill.skillname}
                        fallbackText={skill.skillname}
                        size="sm"
                        className="w-11 h-11 rounded-lg border border-slate-700"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <div className="font-medium text-sm text-slate-100">
                            {skill.skillname}
                          </div>
                          {skill['skillcd&cost'] && (
                            <span className="text-[11px] font-mono tabular-nums text-amber-300/90">
                              {skill['skillcd&cost']}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          {stripHtmlTags(skill.skilldesc || '')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Counters & Compatibility */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {counters?.data?.sub_hero && counters.data.sub_hero.length > 0 && (
                <div className="rounded-xl border border-slate-800 bg-[#111827] p-4 space-y-3">
                  <h3 className="font-display text-sm font-semibold text-slate-100">
                    Strong Against
                  </h3>
                  <div className="space-y-2.5">
                    {counters.data.sub_hero.slice(0, 5).map((sub) => {
                      const info = heroNameMap.get(sub.heroid);
                      const label = sub.hero?.data?.name || info?.name || `Hero #${sub.heroid}`;
                      return (
                        <button
                          key={sub.heroid}
                          type="button"
                          onClick={() => onSelectHero(sub.heroid)}
                          className="w-full flex items-center justify-between gap-2 text-left hover:bg-slate-800/50 p-1.5 rounded-lg transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <SafeImage
                              src={sub.hero?.data?.head || info?.head}
                              alt={label}
                              fallbackText={label}
                              size="sm"
                              className="w-8 h-8 rounded-md"
                            />
                            <span className="text-xs font-medium text-slate-200 truncate">
                              {label}
                            </span>
                          </div>
                          <span className="text-xs font-mono tabular-nums text-emerald-400 shrink-0">
                            +{formatPercent(sub.increase_win_rate)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {compat?.data?.sub_hero && compat.data.sub_hero.length > 0 && (
                <div className="rounded-xl border border-slate-800 bg-[#111827] p-4 space-y-3">
                  <h3 className="font-display text-sm font-semibold text-slate-100">
                    Best Teammates
                  </h3>
                  <div className="space-y-2.5">
                    {compat.data.sub_hero.slice(0, 5).map((sub) => {
                      const info = heroNameMap.get(sub.heroid);
                      const label = sub.hero?.data?.name || info?.name || `Hero #${sub.heroid}`;
                      return (
                        <button
                          key={sub.heroid}
                          type="button"
                          onClick={() => onSelectHero(sub.heroid)}
                          className="w-full flex items-center justify-between gap-2 text-left hover:bg-slate-800/50 p-1.5 rounded-lg transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <SafeImage
                              src={sub.hero?.data?.head || info?.head}
                              alt={label}
                              fallbackText={label}
                              size="sm"
                              className="w-8 h-8 rounded-md"
                            />
                            <span className="text-xs font-medium text-slate-200 truncate">
                              {label}
                            </span>
                          </div>
                          <span className="text-xs font-mono tabular-nums text-amber-300 shrink-0">
                            +{formatPercent(sub.increase_win_rate)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
