
-- Trigger: when a new auth user signs up, create a matching bot_customers row
CREATE OR REPLACE FUNCTION public.handle_new_auth_user_create_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  synthetic_chat_id bigint;
  display_name text;
  attempts int := 0;
BEGIN
  -- Skip if a customer already exists for this auth user
  IF EXISTS (SELECT 1 FROM public.bot_customers WHERE auth_user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  display_name := COALESCE(
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'name',
    split_part(COALESCE(NEW.email, ''), '@', 1)
  );

  -- Find a free synthetic negative chat_id for web-only users
  LOOP
    synthetic_chat_id := -((floor(random() * 1e12))::bigint + 1);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.bot_customers WHERE chat_id = synthetic_chat_id);
    attempts := attempts + 1;
    IF attempts > 10 THEN
      EXIT;
    END IF;
  END LOOP;

  BEGIN
    INSERT INTO public.bot_customers (chat_id, first_name, auth_user_id)
    VALUES (synthetic_chat_id, NULLIF(display_name, ''), NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'handle_new_auth_user_create_customer failed for %: % %', NEW.id, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_create_customer ON auth.users;
CREATE TRIGGER on_auth_user_created_create_customer
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_auth_user_create_customer();

-- Backfill: create bot_customers rows for existing auth users that don't have one
DO $$
DECLARE
  u record;
  synthetic_chat_id bigint;
  display_name text;
  attempts int;
BEGIN
  FOR u IN
    SELECT au.id, au.email, au.raw_user_meta_data
    FROM auth.users au
    WHERE NOT EXISTS (SELECT 1 FROM public.bot_customers c WHERE c.auth_user_id = au.id)
  LOOP
    display_name := COALESCE(
      u.raw_user_meta_data->>'first_name',
      u.raw_user_meta_data->>'name',
      split_part(COALESCE(u.email, ''), '@', 1)
    );
    attempts := 0;
    LOOP
      synthetic_chat_id := -((floor(random() * 1e12))::bigint + 1);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.bot_customers WHERE chat_id = synthetic_chat_id);
      attempts := attempts + 1;
      IF attempts > 10 THEN EXIT; END IF;
    END LOOP;
    BEGIN
      INSERT INTO public.bot_customers (chat_id, first_name, auth_user_id)
      VALUES (synthetic_chat_id, NULLIF(display_name, ''), u.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'backfill bot_customers failed for %: % %', u.id, SQLERRM, SQLSTATE;
    END;
  END LOOP;
END $$;
