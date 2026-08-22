================================================================
 BISER MARKET — putting it on the internet
================================================================

You need two free accounts: Supabase (the database) and Netlify
(the website). Neither will ask for a card. Total time ~15 min.

Do the database FIRST. The site is useless without it.


----------------------------------------------------------------
 PART 1 — THE DATABASE (Supabase)
----------------------------------------------------------------

1. Go to  https://supabase.com  and sign in with GitHub.

2. Click "New project".
      Name:     biser-market
      Region:   Frankfurt  (closest to Bulgaria)
      Password: anything - you will not need it again
   Click "Create new project" and wait ~2 minutes.

3. In the left sidebar click "SQL Editor", then "New query".

4. Open the file  database-setup.sql  from this folder in any
   text editor. Select all, copy, paste into the SQL Editor.

5. Press "Run" (or Ctrl+Enter). Wait for "Success".

   If it shows an error instead, STOP and send the error to
   Thomas or to Claude. Do not run it a second time.

6. In the sidebar click the gear icon, "Project Settings",
   then "API". Leave this page open - you need two values
   from it in Part 2:

      Project URL    looks like  https://abcdefgh.supabase.co
      anon public    a very long string starting with  eyJ...

   IMPORTANT: use the key labelled "anon public".
   NEVER use the one labelled "service_role".


----------------------------------------------------------------
 PART 2 — POINT THE SITE AT IT
----------------------------------------------------------------

7. In this folder, open  config.js  in a text editor.
   (Notepad on Windows, TextEdit on Mac, anything at all.)

8. Replace the two placeholder values with what you copied:

      window.BISER_CONFIG = {
        supabaseUrl:     "https://abcdefgh.supabase.co",
        supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
      };

   Keep the quotes and the commas. Save the file.


----------------------------------------------------------------
 PART 3 — PUT IT ONLINE (Netlify)
----------------------------------------------------------------

9. Go to  https://app.netlify.com/drop

10. Drag this whole folder onto the page.
    (The folder itself - not the files inside it.)

11. Wait a few seconds. Netlify gives you a live address like
        https://sparkly-cat-123456.netlify.app

    That is your site. It is on the internet. Share it.

    To rename it: Site configuration > Change site name.


----------------------------------------------------------------
 PART 4 — MAKE YOURSELF THE GAME MAKER
----------------------------------------------------------------

12. Open your new site, type your email, press the button.
    A sign-in link arrives by email. Open it.

    You will see "Waiting for approval". That is correct -
    fix it in the next step.

13. Back in Supabase, SQL Editor, new query. Paste this,
    putting YOUR email between the quotes:

      update profiles
         set role = 'game_maker', is_approved = true
       where id = (select id from auth.users
                    where email = 'you@example.com');

    Press Run. Refresh your site. A gold "Game maker" button
    appears in the corner.


----------------------------------------------------------------
 PART 5 — RUN A TOURNAMENT
----------------------------------------------------------------

14. Press "Game maker", then "panel".

15. "Tournament" tab - give it a name and a short slug,
    press Create.

16. "Tab import" tab. Open your tournament's draw in another
    browser tab, at an address like:

      https://yourtournament.calicotab.com/api/v1/tournaments/
        open/rounds/1/pairings

    Select all, copy, paste it into the big box.
    Set the round number and name.

    Press "Import draw & make the markets".

    That creates the teams, the rooms, and the markets: the
    call and the top speaker for every room, the motion
    category for the round, plus the tournament winner and
    top speaker. One press.

17. Everyone else just opens the site and signs in. They start
    with 1000 bisers each.

    By default only people on your registration list can bet.
    To let anyone bet, approve them under "People", or import
    a registration list there.


----------------------------------------------------------------
 CHANGING THINGS LATER
----------------------------------------------------------------

To change the site: edit config.js, drag the folder to
Netlify again. Netlify replaces the old version.

To wipe all the play money and start fresh: Supabase SQL
Editor, run:

      delete from bets;
      delete from positions;
      delete from markets;
      update profiles set balance = 1000;


----------------------------------------------------------------
 IF SOMETHING IS WRONG
----------------------------------------------------------------

"Point this site at your database"
    config.js still has the placeholders in it, or was not
    saved. Edit it, re-upload the folder.

Page loads but nothing happens after the email link
    The link must be opened on the same device you are
    browsing on. Check spam too.

"Waiting for approval"
    Step 13 has not been done for that person.

Everything is play money. There is no real money anywhere in
this system and there must never be.
================================================================
