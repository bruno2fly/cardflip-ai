import {
  BookOpen, Zap, Boxes, Award,
  CheckCircle2, XCircle, AlertTriangle, Package, Tag, Lock, ArrowRight,
} from "lucide-react";

export const metadata = { title: "Guide — CardFlip AI" };

/* ---------- small building blocks ---------- */

function StepNumber({ n }: { n: string }) {
  return (
    <div className="flex-shrink-0 w-12 h-12 rounded-full bg-yellow-400 text-gray-900 font-extrabold text-lg flex items-center justify-center">
      {n}
    </div>
  );
}

function StepCard({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 border-l-4 border-l-yellow-400 rounded-xl p-6">
      <div className="flex items-start gap-4">
        <StepNumber n={n} />
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-bold text-base mb-2">{title}</h3>
          <div className="space-y-3 text-sm text-gray-300 leading-relaxed">{children}</div>
        </div>
      </div>
    </div>
  );
}

function KeyRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 bg-gray-800/60 rounded-lg px-3 py-2.5">
      <div className="sm:w-40 flex-shrink-0">{label}</div>
      <p className="text-gray-400 text-xs leading-relaxed">{children}</p>
    </div>
  );
}

function MistakeCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 border-l-4 border-l-red-500 rounded-xl p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-white font-semibold text-sm mb-1">{title}</div>
          <p className="text-gray-400 text-xs leading-relaxed">{children}</p>
        </div>
      </div>
    </div>
  );
}

/* ---------- the guide ---------- */

export default function Guide() {
  return (
    <div className="max-w-3xl mx-auto space-y-12 pb-16">

      {/* 1. Hero */}
      <div className="space-y-5">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <BookOpen size={26} className="text-yellow-400" /> How to Use CardFlip AI
          </h1>
          <p className="text-gray-400 text-base mt-2 leading-relaxed">
            You&apos;re here to flip cards for profit. This guide shows you exactly how — step by step.
          </p>
        </div>

        {/* Journey progress */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-500 text-xs mb-3">You are here: <span className="text-yellow-400 font-semibold">Week 1 of your flip journey</span></div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 bg-yellow-400/10 border border-yellow-400/40 text-yellow-400 text-xs font-semibold px-3 py-1.5 rounded-full">
              🌱 Learn the basics
            </span>
            <ArrowRight size={14} className="text-gray-600" />
            <span className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 text-gray-500 text-xs font-medium px-3 py-1.5 rounded-full">
              💰 First flips
            </span>
            <ArrowRight size={14} className="text-gray-600" />
            <span className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 text-gray-500 text-xs font-medium px-3 py-1.5 rounded-full">
              📈 Scale up
            </span>
          </div>
        </div>
      </div>

      {/* 2. Golden Rules */}
      <div className="bg-gray-900 border-2 border-yellow-400/50 rounded-xl p-6">
        <h2 className="text-yellow-400 font-bold text-lg mb-4 flex items-center gap-2">
          ⭐ The Golden Rules
        </h2>
        <div className="space-y-3">
          {[
            "Never spend more than 20% of your bankroll on a single card.",
            "Only buy cards with positive ROI after fees.",
            "Fast flips beat big margins — cash flow wins.",
            "When in doubt, Pass. Another deal always comes.",
          ].map((rule, i) => (
            <div key={i} className="flex items-start gap-3 bg-gray-950/60 border border-gray-800 border-l-4 border-l-green-500 rounded-lg px-4 py-3">
              <CheckCircle2 size={16} className="text-green-400 flex-shrink-0 mt-0.5" />
              <p className="text-gray-200 text-sm font-medium">{rule}</p>
            </div>
          ))}
        </div>
        <p className="text-gray-500 text-xs mt-4">
          Read these twice. Every mistake in the &quot;beginner mistakes&quot; section below is one of these rules being broken.
        </p>
      </div>

      {/* 3. Step-by-step */}
      <div className="space-y-5">
        <h2 className="text-white font-bold text-xl">The flip loop — six steps, repeat forever</h2>

        <StepCard n="01" title="Set your budget">
          <p>
            Before touching any card, enter your total bankroll in the <span className="text-white font-semibold">Budget box on the Hunt List</span>.
            This is ALL the cash you have to flip with. Start with what you can afford to lose — <span className="text-green-400 font-semibold">$200–$500 for a beginner</span>.
          </p>
          <div className="inline-flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5">
            <span className="text-white text-sm font-semibold">My Budget</span>
            <span className="bg-gray-950 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-500 tabular">$ _____</span>
          </div>
          <p className="text-gray-500 text-xs">The app hides cards you can&apos;t afford.</p>
        </StepCard>

        <StepCard n="02" title="Turn on Starter Mode 🌱">
          <p>
            If you&apos;re new, keep <span className="text-green-400 font-semibold">Starter Mode ON</span>. It filters out expensive slow-moving
            cards and only shows fast, affordable flips. You&apos;ll see the toggle at the top of the Hunt List.
            Leave it ON for your first 30 days.
          </p>
          <div className="space-y-2">
            <div className="text-gray-500 text-xs font-medium uppercase tracking-wide">What changes when it&apos;s on</div>
            <div className="flex flex-wrap gap-2">
              <span className="bg-green-950/60 border border-green-700/40 text-green-400 text-xs font-medium px-3 py-1.5 rounded-full">Only shows cards under $40</span>
              <span className="bg-green-950/60 border border-green-700/40 text-green-400 text-xs font-medium px-3 py-1.5 rounded-full">Only fast sellers (2–5 days)</span>
              <span className="bg-green-950/60 border border-green-700/40 text-green-400 text-xs font-medium px-3 py-1.5 rounded-full flex items-center gap-1">
                <Lock size={11} /> Locks PSA Grading so you don&apos;t blow cash on slabs yet
              </span>
            </div>
          </div>
        </StepCard>

        <StepCard n="03" title="Read the Hunt List">
          <p>The Hunt List is your daily deal feed. Here&apos;s how to read a card:</p>
          <div className="space-y-2">
            <KeyRow label={
              <span className="inline-flex gap-1">
                <span className="bg-green-950/80 border border-green-700/50 text-green-400 text-[11px] font-bold px-2 py-0.5 rounded-full">A flip</span>
                <span className="bg-yellow-950/80 border border-yellow-700/50 text-yellow-400 text-[11px] font-bold px-2 py-0.5 rounded-full">B flip</span>
                <span className="bg-red-950/80 border border-red-700/50 text-red-400 text-[11px] font-bold px-2 py-0.5 rounded-full">Pass</span>
              </span>
            }>
              A flip = strong buy. B flip = worth considering. Pass = skip it.
            </KeyRow>
            <KeyRow label={<span className="text-green-400 text-xs font-bold tabular">ROI %</span>}>
              Return on your money after fees + shipping. Negative = don&apos;t touch it.
            </KeyRow>
            <KeyRow label={<span className="text-green-400 text-sm font-extrabold tabular">Max Buy Price</span>}>
              The MOST you should pay. Pay less = more profit.
            </KeyRow>
            <KeyRow label={<span className="text-white text-xs font-semibold">Est. Profit</span>}>
              What you make after 13% platform fees + $5 shipping.
            </KeyRow>
            <KeyRow label={
              <span className="bg-green-950/60 border border-green-700/40 text-green-400 text-[11px] font-medium px-2.5 py-1 rounded-full">⏱ Sells fast</span>
            }>
              How fast this card typically sells. Sells fast = days. Slow = weeks.
            </KeyRow>
            <KeyRow label={<span className="text-gray-400 text-xs flex items-center gap-1"><Lock size={10} /> Bankroll warning</span>}>
              How much of your budget this one card locks up.
            </KeyRow>
          </div>
          <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-lg px-4 py-3">
            <p className="text-yellow-300 text-xs font-semibold">
              Rule: Only buy A or B flips with positive ROI and a velocity of Sells fast or Moderate.
            </p>
          </div>
        </StepCard>

        <StepCard n="04" title="Find the card (3-platform search)">
          <p>Found an A flip? Now go buy it cheap. Check all three:</p>
          <div className="space-y-2">
            <KeyRow label={<span className="bg-yellow-500 text-gray-900 text-[11px] font-semibold px-2.5 py-1 rounded-md">TCGPlayer</span>}>
              Buying from other collectors — usually the fairest price.
            </KeyRow>
            <KeyRow label={<span className="bg-pink-500/10 border border-pink-500/30 text-pink-400 text-[11px] font-semibold px-2.5 py-1 rounded-md">Mercari</span>}>
              Messy listings, sometimes underpriced gems.
            </KeyRow>
            <KeyRow label={<span className="bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[11px] font-semibold px-2.5 py-1 rounded-md">eBay</span>}>
              Widest selection — filter by Buy It Now + lowest price (the app&apos;s button does this for you).
            </KeyRow>
          </div>
          <p>
            Your goal: <span className="text-green-400 font-semibold">buy at or below the Max Buy Price</span> shown on the card.
          </p>
        </StepCard>

        <StepCard n="05" title="Add it to your Inventory">
          <p>
            Once you buy a card, go to <span className="text-white font-semibold inline-flex items-center gap-1"><Package size={13} /> Inventory</span> →
            search the card → enter what you paid. Now the Market Scanner tracks it and tells you when to sell.
          </p>
          <p>
            <span className="text-white font-semibold inline-flex items-center gap-1"><Zap size={13} /> The Scanner</span> shows
            your cards vs live market prices. When it says <span className="text-green-400 font-semibold">BUY OPPORTUNITY</span>,
            that means the market moved up — time to list yours.
          </p>
        </StepCard>

        <StepCard n="06" title="List it and get paid">
          <p>
            Go to <span className="text-white font-semibold inline-flex items-center gap-1"><Tag size={13} /> Listings</span> →
            mark the card active → list it on TCGPlayer or eBay at the <span className="text-yellow-400 font-semibold">Average Sell Price</span> shown.
          </p>
          <p className="text-white font-semibold">
            Don&apos;t go higher. Don&apos;t get greedy. Move the card, get the cash, repeat.
          </p>
        </StepCard>
      </div>

      {/* 4. Bonus tools */}
      <div className="space-y-5">
        <h2 className="text-white font-bold text-xl">Bonus tools — use when you&apos;re ready</h2>

        <div className="bg-gray-900 border border-gray-800 border-l-4 border-l-yellow-400 rounded-xl p-6">
          <h3 className="text-white font-bold text-base mb-2 flex items-center gap-2">
            <Boxes size={17} className="text-yellow-400" /> Lot Analyzer
          </h3>
          <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
            <p>
              Someone&apos;s selling a bundle of 10 cards for $300. Good deal or not? Go to
              <span className="text-white font-semibold"> Lot Analyzer</span> → type in each card → enter the lot price →
              get an instant <span className="text-green-400 font-semibold">GO</span> or <span className="text-red-400 font-semibold">NO-GO</span>.
              The app tells you the break value (what the cards are worth individually) and the max you should bid.
            </p>
            <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-lg px-4 py-3">
              <p className="text-yellow-300 text-xs font-semibold">
                Key rule: Never bid above the Target Bid. The 0.65 multiplier exists because some cards won&apos;t sell,
                some are damaged, and time costs money.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 border-l-4 border-l-yellow-400 rounded-xl p-6">
          <h3 className="text-white font-bold text-base mb-2 flex items-center gap-2">
            <Award size={17} className="text-yellow-400" /> PSA Grading Calculator
          </h3>
          <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
            <p>
              Grading means sending a card to PSA to get it professionally rated. A PSA 10 can be worth 3x the raw
              price — but it costs <span className="text-white font-semibold">$25 + 45 days of locked-up cash</span>.
              Use this ONLY after 30 days of flipping. Search the card → enter what you paid → see if the PSA 10
              upside justifies the risk.
            </p>
            <div className="bg-red-950/50 border border-red-700/50 rounded-lg px-4 py-3 flex items-start gap-2">
              <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-xs font-semibold">
                If the PSA 9 row shows a loss, the card isn&apos;t good enough to grade. Only send cards that look flawless.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Common beginner mistakes */}
      <div className="space-y-5">
        <h2 className="text-white font-bold text-xl">Five mistakes that empty a beginner&apos;s bankroll</h2>
        <div className="space-y-3">
          <MistakeCard title="Overpaying">
            Paid $65 for a $60 market card. You locked in a loss before you started.
          </MistakeCard>
          <MistakeCard title="Ignoring fees">
            13% + $5 shipping comes off EVERY sale. Always.
          </MistakeCard>
          <MistakeCard title="Grading cheap cards">
            Sending a $30 card to PSA costs $25. You need a PSA 10 to make $5. Not worth it.
          </MistakeCard>
          <MistakeCard title="One big bet">
            Dropping $800 of your $1,000 bankroll on one card. If it doesn&apos;t sell, you&apos;re stuck.
          </MistakeCard>
          <MistakeCard title="Buying slow movers for thin margins">
            A +8% ROI on a 6-week card = your money&apos;s dead for 6 weeks.
          </MistakeCard>
        </div>
      </div>

      {/* 6. Cheat sheet */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-white font-bold text-lg mb-4">Quick reference — tape this to your monitor</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-green-950/50 border border-green-800/50 rounded-xl p-5">
            <div className="flex items-center gap-2 text-green-400 font-bold text-sm mb-3">
              <CheckCircle2 size={16} /> Green light — Buy when:
            </div>
            <ul className="space-y-2 text-xs text-green-200/90">
              <li className="flex items-start gap-2"><span className="text-green-400">·</span> A or B deal score</li>
              <li className="flex items-start gap-2"><span className="text-green-400">·</span> Positive ROI after fees</li>
              <li className="flex items-start gap-2"><span className="text-green-400">·</span> Sells fast or Moderate velocity</li>
              <li className="flex items-start gap-2"><span className="text-green-400">·</span> Under 20% of your bankroll</li>
            </ul>
          </div>
          <div className="bg-red-950/50 border border-red-800/50 rounded-xl p-5">
            <div className="flex items-center gap-2 text-red-400 font-bold text-sm mb-3">
              <XCircle size={16} /> Red light — Pass when:
            </div>
            <ul className="space-y-2 text-xs text-red-200/90">
              <li className="flex items-start gap-2"><span className="text-red-400">·</span> Pass deal score</li>
              <li className="flex items-start gap-2"><span className="text-red-400">·</span> Negative ROI</li>
              <li className="flex items-start gap-2"><span className="text-red-400">·</span> Slow move + under $12 profit</li>
              <li className="flex items-start gap-2"><span className="text-red-400">·</span> Eats more than 30% of your bankroll</li>
            </ul>
          </div>
        </div>
        <p className="text-gray-600 text-xs mt-4 text-center">
          Cash flow wins. Small, fast, boring flips build bankrolls. Good hunting. 🎯
        </p>
      </div>
    </div>
  );
}
