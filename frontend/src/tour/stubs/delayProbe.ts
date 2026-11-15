/** The tour's stand-in for api/delayProbe (vite.tour.config.ts aliases it): the tour has no core to time, so it does nothing. */
export const delayProbe = {
  on: false,
  received(): void {},
  drawn(): void {},
  report(): Record<string, unknown> {
    return {};
  },
};
