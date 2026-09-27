/**
 * Data-Driven Motivational Insights Engine.
 *
 * Derives personalized, psychologically empowering, and actionable insights
 * directly from the user's focus sessions, daily goals, streaks, subjects,
 * and time-of-day patterns.
 *
 * Every motivational insight is grounded in concrete numbers from the user's
 * actual data rather than generic platitudes.
 */

import type { OverviewDto, SubjectDto } from './api';
import { duration } from './format';

export interface MotivationalInsight {
  id: string;
  category: 'goal' | 'streak' | 'rhythm' | 'mastery' | 'quality' | 'velocity';
  icon: string;
  badge: string;
  title: string;
  message: string;
  highlightMetric?: {
    label: string;
    value: string;
    sublabel?: string;
    percent?: number;
  };
  actionTip?: string;
  tone: 'gold' | 'emerald' | 'amber' | 'cyan' | 'violet';
}

export interface MomentumProfile {
  tier: 'unstoppable' | 'in-flow' | 'target-hunter' | 'streak-guardian' | 'primed';
  tierLabel: string;
  tierBadge: string;
  tierIcon: string;
  score: number; // 0-100 score of current day momentum
  insights: MotivationalInsight[];
  headline: MotivationalInsight;
}

/**
 * Generate a complete motivational profile from overview and context data.
 */
export function generateMotivationalInsights(params: {
  overview: OverviewDto | null;
  subjects?: SubjectDto[];
  timerPhase?: string;
}): MomentumProfile {
  const { overview, subjects = [], timerPhase = 'idle' } = params;

  if (!overview) {
    const emptyInsight: MotivationalInsight = {
      id: 'welcome',
      category: 'velocity',
      icon: '✨',
      badge: 'Fresh Start',
      title: 'Every masterpiece starts with a single minute',
      message: 'Choose your subject on the dial and press Begin. Your first session will lay the cornerstone for meaningful insights.',
      actionTip: 'Pick a 25-minute block to get your momentum rolling.',
      tone: 'cyan',
    };

    return {
      tier: 'primed',
      tierLabel: 'Primed & Ready',
      tierBadge: 'DAY 1',
      tierIcon: '🌱',
      score: 10,
      insights: [emptyInsight],
      headline: emptyInsight,
    };
  }

  const { today, week, streak, recentSessions } = overview;
  const insights: MotivationalInsight[] = [];
  const currentHour = new Date().getHours();

  // 1. Calculate a dynamic momentum score (0-100)
  let momentumScore = 0;
  if (today.goalMet) momentumScore += 45;
  else if (today.goalSeconds > 0) {
    momentumScore += Math.min(40, Math.round((today.focusedSeconds / today.goalSeconds) * 40));
  } else if (today.focusedSeconds > 0) {
    momentumScore += 25;
  }

  if (streak.daily.current > 0) {
    momentumScore += Math.min(30, streak.daily.current * 7);
  }
  if (today.sessionCount > 0) {
    momentumScore += Math.min(15, today.sessionCount * 5);
  }
  if (week.focusedSeconds > 7200) {
    momentumScore += 10;
  }
  momentumScore = Math.min(100, Math.max(10, momentumScore));

  // Determine Momentum Tier
  let tier: MomentumProfile['tier'] = 'primed';
  let tierLabel = 'Primed & Ready';
  let tierBadge = 'READY TO LAUNCH';
  let tierIcon = '🌱';

  if (today.goalMet && streak.daily.current >= 3) {
    tier = 'unstoppable';
    tierLabel = 'Unstoppable Flow';
    tierBadge = 'PEAK MOMENTUM';
    tierIcon = '🔥';
  } else if (today.goalMet || today.sessionCount >= 3) {
    tier = 'in-flow';
    tierLabel = 'Locked In Deep Flow';
    tierBadge = 'FLOW STATE';
    tierIcon = '⚡';
  } else if (today.goalSeconds > 0 && today.remainingSeconds <= 1800 && today.remainingSeconds > 0) {
    tier = 'target-hunter';
    tierLabel = 'Target In Crosshairs';
    tierBadge = 'FINAL SPRINT';
    tierIcon = '🎯';
  } else if (streak.daily.current > 1) {
    tier = 'streak-guardian';
    tierLabel = 'Streak Protected';
    tierBadge = `${streak.daily.current}-DAY RUN`;
    tierIcon = '🛡️';
  }

  // 2. Derive Goal-Based Motivational Insight
  if (today.goalMet) {
    const overtime = Math.max(0, today.focusedSeconds - today.goalSeconds);
    insights.push({
      id: 'goal-achieved',
      category: 'goal',
      icon: '🏆',
      badge: 'Goal Conquered',
      title: overtime > 300 
        ? `Target crushed +${duration(overtime)} into bonus territory!`
        : "Today's goal officially in the bag!",
      message: overtime > 300
        ? `You completed your ${duration(today.goalSeconds)} target and kept going. This extra stretch is where exponential growth lives.`
        : `You set your intention and delivered ${duration(today.focusedSeconds)} of deep work today. Give yourself credit—consistency like this is rare.`,
      highlightMetric: {
        label: 'Today Recorded',
        value: duration(today.focusedSeconds),
        sublabel: overtime > 0 ? `+${duration(overtime)} bonus` : '100% of goal',
        percent: 100,
      },
      actionTip: 'Take a restorative breather or ride the wave if your concentration is still sharp.',
      tone: 'emerald',
    });
  } else if (today.goalSeconds > 0) {
    const pct = Math.round((today.focusedSeconds / today.goalSeconds) * 100);
    const rem = today.remainingSeconds;

    if (rem <= 1500) {
      insights.push({
        id: 'goal-close',
        category: 'goal',
        icon: '🎯',
        badge: 'Within Striking Distance',
        title: `Only ${duration(rem)} away from today's target!`,
        message: `You're ${pct}% of the way there. Just one short 20-minute session will lock in today's achievement and maintain your run.`,
        highlightMetric: {
          label: 'Target Progress',
          value: `${pct}%`,
          sublabel: `${duration(rem)} to go`,
          percent: pct,
        },
        actionTip: 'Hit Begin on a 25m sprint right now to seal the victory.',
        tone: 'gold',
      });
    } else if (today.focusedSeconds > 0) {
      insights.push({
        id: 'goal-in-progress',
        category: 'goal',
        icon: '🚀',
        badge: 'Momentum Building',
        title: `${duration(today.focusedSeconds)} in the bank — foundation solid`,
        message: `You've already put in ${today.sessionCount} focused session${today.sessionCount === 1 ? '' : 's'}. You're halfway up the mountain; maintain pace and today is yours.`,
        highlightMetric: {
          label: 'Completed',
          value: duration(today.focusedSeconds),
          sublabel: `Target ${duration(today.goalSeconds)}`,
          percent: pct,
        },
        actionTip: 'Queue your next priority subject and start the clock.',
        tone: 'cyan',
      });
    } else {
      insights.push({
        id: 'goal-starting',
        category: 'goal',
        icon: '🌅',
        badge: 'Daily Blueprint',
        title: `Your ${duration(today.goalSeconds)} target awaits your command`,
        message: 'The hardest part of any focus journey is simply crossing the starting threshold. Once the dial starts turning, friction disappears.',
        highlightMetric: {
          label: 'Today Target',
          value: duration(today.goalSeconds),
          sublabel: 'Clean canvas',
          percent: 0,
        },
        actionTip: 'Start with just 15 minutes to overcome initial hesitation.',
        tone: 'violet',
      });
    }
  }

  // 3. Derive Streak-Based Motivational Insight
  if (streak.daily.current > 1) {
    const isAtRecord = streak.daily.current >= streak.daily.longest && streak.daily.longest > 1;
    insights.push({
      id: 'streak-power',
      category: 'streak',
      icon: '🔥',
      badge: 'Unbroken Chain',
      title: isAtRecord
        ? `All-time personal record! ${streak.daily.current} days in a row!`
        : `${streak.daily.current} consecutive days of disciplined execution`,
      message: isAtRecord
        ? `You are in uncharted territory. Your daily habit is stronger than ever—every single day you add sets a new personal benchmark.`
        : `You are building an automatic habit. Only ${Math.max(1, streak.daily.longest - streak.daily.current)} more day${streak.daily.longest - streak.daily.current === 1 ? '' : 's'} until you match your record of ${streak.daily.longest} days!`,
      highlightMetric: {
        label: 'Active Streak',
        value: `${streak.daily.current} Days`,
        sublabel: isAtRecord ? 'Personal Record' : `Best: ${streak.daily.longest}d`,
      },
      actionTip: streak.daily.isTodayMet
        ? "Today's quota is already secured. Great discipline!"
        : `Record ${duration(streak.daily.thresholdSeconds)} today to keep this fire blazing.`,
      tone: 'gold',
    });
  } else if (streak.daily.current === 1 && today.focusedSeconds > 0) {
    insights.push({
      id: 'streak-spark',
      category: 'streak',
      icon: '⚡',
      badge: 'Habit Ignited',
      title: 'Day 1 locked in — the spark has been struck',
      message: 'Great achievements don’t start with grand leaps; they begin with showing up on day one. Come back tomorrow to forge Day 2.',
      highlightMetric: {
        label: 'Current Streak',
        value: '1 Day',
        sublabel: 'The first link',
      },
      tone: 'amber',
    });
  }

  // 4. Time-of-Day / Rhythm Intelligence
  const timeGreeting =
    currentHour >= 5 && currentHour < 12
      ? { label: 'Morning Clarity', msg: 'Morning hours offer peak cognitive endurance with minimal external interference.' }
      : currentHour >= 12 && currentHour < 17
      ? { label: 'Afternoon Flow', msg: 'Push through the afternoon dip with structured 25-minute sprints and crisp breaks.' }
      : currentHour >= 17 && currentHour < 22
      ? { label: 'Prime Evening Window', msg: 'Evenings are perfect for reflective study, review, and wrapping up key concepts.' }
      : { label: 'Night Owl Drive', msg: 'The world is quiet. Zero interruptions mean high-density deep work.' };

  insights.push({
    id: 'circadian-flow',
    category: 'rhythm',
    icon: '⏳',
    badge: timeGreeting.label,
    title: timerPhase === 'focus' ? 'Clock is rolling in your focus window' : 'Prime focus window is open right now',
    message: timeGreeting.msg,
    actionTip: 'Eliminate browser tabs and silence notifications for this block.',
    tone: 'cyan',
  });

  // 5. Weekly Volume & Velocity
  if (week.focusedSeconds > 0) {
    const weekHours = (week.focusedSeconds / 3600).toFixed(1);
    const activeDaysCount = week.series.filter((s) => s.focusedSeconds > 0).length;
    insights.push({
      id: 'weekly-velocity',
      category: 'velocity',
      icon: '📈',
      badge: 'Weekly Traction',
      title: `${weekHours} hours banked across ${activeDaysCount} day${activeDaysCount === 1 ? '' : 's'} this week`,
      message: `Your weekly investment is compounding. Consistency across multiple days produces 3x better memory retention than weekend cramming.`,
      highlightMetric: {
        label: 'Weekly Total',
        value: duration(week.focusedSeconds),
        sublabel: `${activeDaysCount} active days`,
      },
      tone: 'violet',
    });
  }

  // 6. Subject Dedication & Mastery
  if (subjects.length > 0 && recentSessions.length > 0) {
    // Find subject with most time
    const subjectMap: Record<string, { count: number; seconds: number; name: string }> = {};
    for (const session of recentSessions) {
      if (!session.subjectId) continue;
      if (!subjectMap[session.subjectId]) {
        subjectMap[session.subjectId] = {
          count: 0,
          seconds: 0,
          name: session.subjectName ?? 'Subject',
        };
      }
      subjectMap[session.subjectId].count += 1;
      subjectMap[session.subjectId].seconds += session.focusedSeconds;
    }

    const topSubjectEntry = Object.values(subjectMap).sort((a, b) => b.seconds - a.seconds)[0];
    if (topSubjectEntry && topSubjectEntry.seconds > 1800) {
      insights.push({
        id: 'subject-mastery',
        category: 'mastery',
        icon: '📚',
        badge: 'Subject Mastery',
        title: `Deep devotion to ${topSubjectEntry.name}`,
        message: `You've invested ${duration(topSubjectEntry.seconds)} into ${topSubjectEntry.name} recently. Deep focus on core subjects creates durable competence.`,
        highlightMetric: {
          label: 'Subject Focus',
          value: duration(topSubjectEntry.seconds),
          sublabel: topSubjectEntry.name,
        },
        tone: 'emerald',
      });
    }
  }

  // 7. Session Quality & Focus Score
  const scoredSessions = recentSessions.filter((s) => typeof s.focusScore === 'number' && s.focusScore > 0);
  if (scoredSessions.length >= 2) {
    const avgScore = Math.round(
      scoredSessions.reduce((acc, s) => acc + (s.focusScore ?? 0), 0) / scoredSessions.length,
    );
    if (avgScore >= 75) {
      insights.push({
        id: 'quality-score',
        category: 'quality',
        icon: '✨',
        badge: 'Quality Standard',
        title: `High-caliber focus score: ${avgScore}/100`,
        message: 'Your recent sessions show minimal interruptions, solid session length, and faithful completion. You are in control of your attention.',
        highlightMetric: {
          label: 'Focus Score',
          value: `${avgScore}/100`,
          sublabel: 'Above baseline',
          percent: avgScore,
        },
        tone: 'gold',
      });
    }
  }

  // Fallback if low on insights
  if (insights.length === 0) {
    insights.push({
      id: 'default-motivation',
      category: 'velocity',
      icon: '⚡',
      badge: 'Action Over Inertia',
      title: 'Action produces motivation, not the other way around',
      message: 'Do not wait to feel ready. Start a 25-minute timer and let momentum carry you forward.',
      actionTip: 'Pick any subject and click Begin.',
      tone: 'cyan',
    });
  }

  // Priority order for the headline insight
  const headline =
    insights.find((i) => i.id === 'goal-achieved') ||
    insights.find((i) => i.id === 'goal-close') ||
    insights.find((i) => i.id === 'streak-power') ||
    insights.find((i) => i.id === 'goal-in-progress') ||
    insights[0];

  return {
    tier,
    tierLabel,
    tierBadge,
    tierIcon,
    score: momentumScore,
    insights,
    headline,
  };
}
