export const strings = {
  home: {
    title: 'My Trips',
    emptyTitle: 'No trips yet',
    emptyBody: 'Create your first trip to get started.',
    createCta: 'New Trip',
    loading: 'Loading trips…',
    errorLoading: 'Could not load your trips. Please try again.',
  },
  createTrip: {
    title: 'New Trip',
    nameLabel: 'Trip name',
    namePlaceholder: 'e.g. Japan 2026',
    startLabel: 'Start date',
    endLabel: 'End date',
    submit: 'Create Trip',
    cancel: 'Cancel',
    errorDateRange: 'End date must be on or after the start date.',
    errorGeneric: 'Something went wrong. Please try again.',
  },
  sections: {
    upcoming: 'Upcoming',
    past: 'Past',
  },
} as const
