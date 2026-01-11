alter table public.absences
  drop constraint if exists absences_reason_check;

alter table public.absences
  add constraint absences_reason_check
  check (reason in ('VACATION', 'TRAINING', 'POST_CALL', 'INTERNSHIP', 'OTHER'));
