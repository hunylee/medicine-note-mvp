begin;

create table public.launch_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  contact text not null check (
    char_length(contact) between 3 and 120
    and (
      contact ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or contact ~ '^(\+82[-[:space:]]?1[016789]|01[016789])[-[:space:]]?[0-9]{3,4}[-[:space:]]?[0-9]{4}$'
    )
  ),
  message text not null default '' check (char_length(message) <= 2000),
  created_at timestamptz not null default now()
);

alter table public.launch_requests enable row level security;
alter table public.launch_requests force row level security;

revoke all on table public.launch_requests from public, anon, authenticated;
grant insert (name, contact, message) on public.launch_requests to anon, authenticated;

create policy "Allow new launch requests only"
  on public.launch_requests
  for insert
  to anon, authenticated
  with check (true);

comment on table public.launch_requests is '정식 버전 알림 신청. 브라우저는 이름·연락처·남긴 말의 새 행 입력만 가능하며 조회·수정·삭제 불가.';

commit;
