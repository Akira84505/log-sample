# log-sample

Keep the first and last lines of a log, discard the middle. A small, zero-dependency ESM module for when you want to display or store a bounded sample of a potentially unbounded stream of log lines.

## Usage

```js
import { LogSampler } from 'log-sample';

const sampler = new LogSampler({ head: 5, tail: 5, marker: '... N lines omitted ...' });

const lines = ['line one', 'line two', 'line three', 'line four', 'line five',
  'line six', 'line seven', 'line eight', 'line nine', 'line ten',
  'line eleven', 'line twelve'];
for (const line of lines) {
  sampler.add(line);
}

console.log(sampler.toString());
// prints the first 5 lines, a marker, then the last 5 lines
```

`add(line)` accepts a single string. `addMany(iterable)` accepts any iterable of strings. `toLines()` returns the sampled result as an array; `toString()` joins them with `\n`. `reset()` clears the sampler while keeping its options. The `head`, `tail`, and `omitted` getters expose the retained lines (as copies) and the count of dropped lines.

## Why

Long logs are common; the interesting parts are almost always at the beginning (how things started) and the end (how they failed or finished). Holding an entire multi-megabyte log in memory just to show its bookends is wasteful. This sampler keeps a fixed-size head and tail buffer and counts the middle, so memory stays bounded regardless of input size.

The trade-off is that the middle is gone &mdash; you see only the count, not the content. If you need to search the middle, you need the original log, not a sample.

## Options

`new LogSampler({ head, tail, marker, markerIf })`:

- `head` (default `10`): leading lines to retain.
- `tail` (default `10`): trailing lines to retain.
- `marker` (default `'... N lines omitted ...'`): text inserted where lines were dropped. Set to `''` to disable the marker entirely.
- `markerIf` (default `1`): minimum number of omitted lines required before the marker is inserted. Raise it to suppress markers for small gaps.

## Edge cases

If the number of lines received is less than or equal to `head + tail`, nothing is omitted and no marker appears &mdash; the head and tail simply abut. If `head` is `0`, there is no leading context; if `tail` is `0`, there is no trailing context; if both are `0`, the sampler records only the omission count and (if `marker` is non-empty and `markerIf` is satisfied) emits just the marker. Lines are stored verbatim; `add` does not strip trailing newlines, so callers should trim before calling if they want clean output.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

