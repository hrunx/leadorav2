import Bottleneck from 'bottleneck';

export const limits = {
  openai: new Bottleneck({
    minTime: Number(process.env.OPENAI_MIN_DELAY_MS ?? 300),
    maxConcurrent: Number(process.env.OPENAI_MAX_CONCURRENT ?? 2)
  }),
  serper: new Bottleneck({ minTime: 180, maxConcurrent: 3 }),
  hunter: new Bottleneck({ minTime: 250, maxConcurrent: 2 }),
  cse:    new Bottleneck({ minTime: 250, maxConcurrent: 2 })
};

export const withLimit = async <T>(limiter: Bottleneck, fn: () => Promise<T>) => limiter.schedule(fn);

