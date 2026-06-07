UPDATE public.bot_products
SET description = regexp_replace(
  description,
  '<blockquote((?:\s[^>]*)?)>(<(b|i|u|s|code)>)(.*?)</blockquote></\3>',
  '<blockquote\1>\2\4</\3></blockquote>',
  'gs'
)
WHERE description ~ '<blockquote[^>]*><(b|i|u|s|code)>.*?</blockquote></\1>';