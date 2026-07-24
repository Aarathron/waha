import { Logger } from 'pino';

type FunctionNoArgs = () => Promise<any>;

/**
 * Run a job (function) after a delay,
 * but make sure we run exactly ONE job at the same time
 */
export class SingleDelayedJobRunner {
  private timeout: NodeJS.Timeout;
  private logger: Logger;

  constructor(
    private name: string,
    private timeoutMs: number,
    logger: Logger,
    private warningOverride: boolean = false,
  ) {
    this.logger = logger.child({
      job: name,
      class: SingleDelayedJobRunner.name,
    });
  }

  get scheduled(): boolean {
    return !!this.timeout;
  }

  /**
   * Schedule the job to run after a delay.
   *
   * @param fn        the job to run
   * @param delayMs   optional per-call delay override (e.g. exponential
   *                  backoff). Defaults to the runner's configured timeout.
   */
  schedule(fn: FunctionNoArgs, delayMs?: number): boolean {
    if (this.scheduled) {
      const msg = `Job has been started before, do not schedule it again`;
      this.log(this.warningOverride, msg);
      return false;
    }

    const delay = delayMs ?? this.timeoutMs;
    this.timeout = setTimeout(() => {
      this.logger.debug(`Running job...`);
      fn()
        .catch((error) => {
          this.logger.error(`Job failed: ${error}`);
          this.logger.error(error.stack);
        })
        .finally(() => {
          this.timeout = null;
          this.logger.debug(`Job finished`);
        });
    }, delay);
    this.logger.info(`Job scheduled with timeout ${delay} ms`);
    return true;
  }

  cancel() {
    if (!this.timeout) {
      return;
    }
    clearTimeout(this.timeout);
    this.timeout = null;
    this.logger.info(`Job cancelled`);
  }

  private log(warning: boolean, msg: string) {
    if (warning) {
      this.logger.warn(msg);
    } else {
      this.logger.info(msg);
    }
  }
}
