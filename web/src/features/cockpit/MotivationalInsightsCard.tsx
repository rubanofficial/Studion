import { useState, useEffect } from 'react';
import { useApp, selectActiveSubjects } from '../../store/app';
import { useTimer } from '../../store/timer';
import { generateMotivationalInsights, type MotivationalInsight } from '../../lib/motivationalInsights';
import { cn } from '../../components/ui';

export function MotivationalInsightsCard({ className }: { className?: string }) {
  const overview = useApp((state) => state.overview);
  const subjects = useApp(selectActiveSubjects);
  const timer = useTimer();

  const profile = generateMotivationalInsights({
    overview,
    subjects,
    timerPhase: timer.phase,
  });

  const { insights, tierLabel, tierIcon, tierBadge, score } = profile;
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Auto-cycle through insights every 8 seconds unless hovered
  useEffect(() => {
    if (isPaused || insights.length <= 1) return;
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % insights.length);
    }, 8000);
    return () => clearInterval(interval);
  }, [isPaused, insights.length]);

  const currentInsight: MotivationalInsight = insights[activeIndex % insights.length] ?? profile.headline;

  const nextInsight = () => {
    setActiveIndex((prev) => (prev + 1) % insights.length);
  };

  const prevInsight = () => {
    setActiveIndex((prev) => (prev - 1 + insights.length) % insights.length);
  };

  // Tone color mappings
  const toneStyles = {
    gold: {
      border: 'border-pause/40',
      glow: 'shadow-[0_0_24px_-8px_rgba(251,191,36,0.3)]',
      badgeBg: 'bg-pause/15 text-pause border-pause/30',
      metricBg: 'bg-pause/10 border-pause/25',
      metricText: 'text-pause',
      accentBar: 'bg-pause',
    },
    emerald: {
      border: 'border-good/40',
      glow: 'shadow-[0_0_24px_-8px_rgba(74,222,128,0.3)]',
      badgeBg: 'bg-good/15 text-good border-good/30',
      metricBg: 'bg-good/10 border-good/25',
      metricText: 'text-good',
      accentBar: 'bg-good',
    },
    cyan: {
      border: 'border-accent/40',
      glow: 'shadow-[0_0_24px_-8px_rgba(94,234,212,0.3)]',
      badgeBg: 'bg-accent/15 text-accent border-accent/30',
      metricBg: 'bg-accent/10 border-accent/25',
      metricText: 'text-accent',
      accentBar: 'bg-accent',
    },
    violet: {
      border: 'border-indigo-400/40',
      glow: 'shadow-[0_0_24px_-8px_rgba(129,140,248,0.3)]',
      badgeBg: 'bg-indigo-500/15 text-indigo-300 border-indigo-400/30',
      metricBg: 'bg-indigo-500/10 border-indigo-400/25',
      metricText: 'text-indigo-300',
      accentBar: 'bg-indigo-400',
    },
    amber: {
      border: 'border-amber-500/40',
      glow: 'shadow-[0_0_24px_-8px_rgba(245,158,11,0.3)]',
      badgeBg: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      metricBg: 'bg-amber-500/10 border-amber-500/25',
      metricText: 'text-amber-400',
      accentBar: 'bg-amber-400',
    },
  }[currentInsight.tone ?? 'cyan'];

  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-gradient-to-br from-surface/90 via-surface/70 to-raised/80 p-5 transition-all duration-calm backdrop-blur-md',
        toneStyles.border,
        toneStyles.glow,
        className,
      )}
    >
      {/* Ambient background light beam */}
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-20 blur-3xl transition-all duration-slow"
        style={{
          background:
            currentInsight.tone === 'emerald'
              ? 'rgb(var(--state-good))'
              : currentInsight.tone === 'gold'
              ? 'rgb(var(--state-pause))'
              : 'rgb(var(--accent))',
        }}
      />

      {/* Top Header Bar: Momentum Status & Switcher Controls */}
      <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-sunken font-mono text-tiny shadow-inner">
            {tierIcon}
          </span>
          <span className="truncate font-mono text-micro uppercase tracking-[0.14em] text-muted">
            {tierLabel}
          </span>
          <span
            className={cn(
              'hidden sm:inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-wider uppercase',
              toneStyles.badgeBg,
            )}
          >
            {tierBadge}
          </span>
        </div>

        {/* Momentum Score Meter & Card Navigation */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5" title={`Momentum Index: ${score}/100`}>
            <span className="font-mono text-micro text-faint">MOMENTUM</span>
            <div className="h-1.5 w-12 overflow-hidden rounded-full bg-sunken">
              <div
                className={cn('h-full transition-all duration-slow ease-forge', toneStyles.accentBar)}
                style={{ width: `${score}%` }}
              />
            </div>
            <span className="font-mono text-micro font-medium text-ink">{score}</span>
          </div>

          {insights.length > 1 && (
            <div className="flex items-center gap-1 pl-1 border-l border-line/60">
              <button
                type="button"
                onClick={prevInsight}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-line bg-sunken text-tiny text-faint transition-colors hover:border-faint hover:text-ink active:scale-95"
                aria-label="Previous motivational insight"
              >
                ←
              </button>
              <span className="font-mono text-micro text-ghost px-1">
                {((activeIndex % insights.length) + 1)}/{insights.length}
              </span>
              <button
                type="button"
                onClick={nextInsight}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-line bg-sunken text-tiny text-faint transition-colors hover:border-faint hover:text-ink active:scale-95"
                aria-label="Next motivational insight"
              >
                →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Body */}
      <div className="mt-4 flex flex-col md:flex-row md:items-start justify-between gap-5">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xl" role="img" aria-hidden="true">
              {currentInsight.icon}
            </span>
            <span className={cn('rounded-md border px-2 py-0.5 font-mono text-micro uppercase tracking-wider', toneStyles.badgeBg)}>
              {currentInsight.badge}
            </span>
          </div>

          <h3 className="text-base sm:text-lead font-semibold text-ink leading-snug">
            {currentInsight.title}
          </h3>

          <p className="text-small text-muted leading-relaxed max-w-2xl">
            {currentInsight.message}
          </p>

          {currentInsight.actionTip && (
            <div className="mt-2.5 flex items-center gap-2 text-tiny text-faint bg-sunken/60 rounded-lg px-3 py-1.5 border border-line/50">
              <span className="text-accent font-mono">▸ Tip:</span>
              <span className="text-muted">{currentInsight.actionTip}</span>
            </div>
          )}
        </div>

        {/* Highlight Data Metric Box */}
        {currentInsight.highlightMetric && (
          <div
            className={cn(
              'shrink-0 rounded-lg border p-3 min-w-[8.5rem] flex flex-col justify-center text-center transition-transform group-hover:scale-[1.02]',
              toneStyles.metricBg,
            )}
          >
            <span className="font-mono text-micro uppercase tracking-wider text-faint">
              {currentInsight.highlightMetric.label}
            </span>
            <span className={cn('mt-0.5 font-mono text-title font-bold numeric-stable', toneStyles.metricText)}>
              {currentInsight.highlightMetric.value}
            </span>
            {currentInsight.highlightMetric.sublabel && (
              <span className="mt-0.5 text-micro text-ghost font-mono">
                {currentInsight.highlightMetric.sublabel}
              </span>
            )}
            {typeof currentInsight.highlightMetric.percent === 'number' && (
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-void/50">
                <div
                  className={cn('h-full rounded-full transition-all duration-calm', toneStyles.accentBar)}
                  style={{ width: `${Math.min(100, Math.max(0, currentInsight.highlightMetric.percent))}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Progress Dots Indicator for carousel */}
      {insights.length > 1 && (
        <div className="mt-4 flex items-center justify-center gap-1.5">
          {insights.map((ins, index) => {
            const isActive = (activeIndex % insights.length) === index;
            return (
              <button
                key={ins.id}
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={`View insight ${index + 1}`}
                className={cn(
                  'h-1 rounded-full transition-all duration-quick',
                  isActive ? cn('w-6', toneStyles.accentBar) : 'w-1.5 bg-line hover:bg-faint',
                )}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
