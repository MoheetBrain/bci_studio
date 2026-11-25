# Neuroverse — playtest sheet (stage 3)

Three toys share one circuit, one set of controls and one visual style. They differ in what you **do**:

| | Toy | The question it is there to answer |
|---|---|---|
| A | Instrument flight | Is flying up to something and finding out what it is doing satisfying in itself? |
| B | Time workshop | Is it enjoyable to change one cause and discover why the result changes? |
| C | Decoder pilot | Does getting a real control loop to work, breaking it and repairing it, make you want another go? |

Nothing in this sheet has been filled in. No one has played these toys yet; the automated tests show that they
work, not that they are worth playing.

## How to run a session

Open `http://127.0.0.1:5180/#/world` (after `npm run dev`). Two sessions, on different days if you can.

1. **Order.** Use the order the chooser suggests (it rotates daily). In the second session use a different one, so
   that no toy is always the first and freshest. Write the order down.
2. **For each toy, about six minutes:**
   - *Two minutes, uncoached.* No reading of panels first. Just try things.
   - *One task* (below). Stop when it is done or when you have had enough.
   - *Optional continuation.* If you want to carry on, carry on — and note that you did, and for how long.
3. **Between toys**, answer the five questions for the toy you just left, before starting the next.
4. Keep the detail setting and the screen the same across toys. If something is broken, write that down separately:
   a bug is not a verdict on the idea.

Tasks:

- **A:** find the cell that starts each wave, using the contacts and the silence button (not “Generator truth”). Then
  press “New field” and say, before testing, how you will find it this time.
- **B:** open “Optional challenge” and do the three steps. Then press “New condition” and make the prediction it asks for.
- **C:** press P and reach six targets. Press “Lose 3 contacts”. Get back to reaching targets — once by a route that
  refits nothing, once by one that does.

## What to write down while playing (behaviour, not opinion)

| | A | B | C |
|---|---|---|---|
| First thing I did | | | |
| Keys or clicks that did something other than I meant (which, how often) | | | |
| Times I overshot, got lost, or could not get back | | | |
| Things I tried that nobody asked for | | | |
| Did I carry on after the task? For how long? | | | |
| Why I stopped | | | |
| Any discomfort (motion, eye strain, confusion about the mouse) | | | |

## Five questions per toy (answer each on its own; do not add them up)

**1 · Enjoyment.** Would I open this again tomorrow without being asked? What, exactly, was the pleasant part — moving,
finding out, or getting something to work?

**2 · Agency.** Did the thing I changed feel like *my* change, with a consequence I could see? Or did I press buttons
and watch?

**3 · What was running.** In my own words: what was computing the signals I saw? (Compare afterwards with “What is
this?”. Note anything I had taken to be real, measured or anatomical that was not.)

**4 · Why it happened.** Pick one result that surprised me. What caused it, and what on the screen is my evidence?

**5 · Transfer.** On the new field / new condition / new fault: did my prediction hold? If not, what did I have wrong?

Then, 48–72 hours later, without reopening the notes: repeat the task of each toy once on a new seed or condition.
Note what else I read or watched about neurons or decoders in between (it counts as exposure).

## Decision (after both sessions)

For each toy write **keep**, **revise** (say what) or **drop**, with the behaviour that decided it:

| Toy | Keep / revise / drop | The observation that decided it |
|---|---|---|
| A | | |
| B | | |
| C | | |

A toy should be dropped if, across both sessions, I did nothing in it beyond what the task asked; if the controls were
still disorienting after a specific fix; if it only became interesting by breaking one of its own scientific rules; or
if what it seemed to teach depends on something the model does not compute.

What this playtest cannot show: that the toys teach better than the classic studio (that needs a matched comparison),
or that anyone but me would enjoy them (that needs other people — six to eight, novices and specialists, would be a
useful next round, still not a study).
