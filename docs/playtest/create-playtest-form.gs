/**
 * CyberShield Academy: playtest questionnaire, built as a Google Form.
 *
 * How to use (once, about two minutes):
 *   1. Go to https://script.google.com and click "New project".
 *   2. Delete what is there, paste this whole file, and click Save.
 *   3. Choose createPlaytestForm in the function menu and click Run.
 *   4. Approve the permissions Google asks for (it needs to create a Form and a
 *      Sheet in your own Drive).
 *   5. Open "Execution log": it prints the link to share and the link to edit.
 *
 * Before sending it out: replace the [bracketed] consent wording with the
 * text from your approved information sheet, if the responses might be used
 * in the dissertation.
 *
 * The form collects no names or email addresses. The only optional link to
 * the platform is the handle a tester chose, which is already a pseudonym.
 */

function createPlaytestForm() {
  const form = FormApp.create('CyberShield Academy: playtest feedback');
  form
    .setDescription(
      'Thank you for trying CyberShield Academy, a game-based platform for learning to defend ' +
      'websites against common attacks. This form takes about 10 minutes. It is anonymous: ' +
      'please do not write your name or email anywhere.'
    )
    .setCollectEmail(false)
    .setAllowResponseEdits(false)
    .setLimitOneResponsePerUser(false) // true would force testers to sign in to Google
    .setProgressBar(true)
    .setShowLinkToRespondAgain(false)
    .setConfirmationMessage('Thank you. Your feedback will be used to improve CyberShield Academy.');

  const AGREE5 = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];

  // ---------------------------------------------------------------- consent
  form.addSectionHeaderItem()
    .setTitle('Information and consent')
    .setHelpText(
      '[Replace with your approved wording.] This playtest is part of a final-year project at ' +
      'the University of Portsmouth London. Taking part is voluntary. No names or email ' +
      'addresses are collected. You can stop at any time before submitting. Because the form ' +
      'is anonymous, a response cannot be withdrawn once submitted unless you give your ' +
      'platform handle below and ask for it to be removed.'
    );
  const consent = form.addMultipleChoiceItem()
    .setTitle('Do you agree to take part?')
    .setRequired(true);
  consent.setChoices([
    consent.createChoice('Yes, I am 18 or over and I agree to take part', FormApp.PageNavigationType.CONTINUE),
    consent.createChoice('No', FormApp.PageNavigationType.SUBMIT),
  ]);

  // ---------------------------------------------------------------- about you
  form.addPageBreakItem().setTitle('About you');
  form.addMultipleChoiceItem()
    .setTitle('Age group')
    .setChoiceValues(['18–24', '25–34', '35–55', 'Prefer not to say'])
    .setRequired(true);
  form.addMultipleChoiceItem()
    .setTitle('How much programming have you done?')
    .setChoiceValues(['None', 'A little (tutorials or a course)', 'Regularly (study or hobby)', 'Professionally'])
    .setRequired(true);
  form.addMultipleChoiceItem()
    .setTitle('How much did you know about web security before today?')
    .setChoiceValues(['Nothing', 'I had heard of it', 'I have studied it', 'I work with it'])
    .setRequired(true);
  form.addCheckboxItem()
    .setTitle('Have you used any of these before? (tick all that apply)')
    .setChoiceValues(['TryHackMe', 'Hack The Box', 'PortSwigger Web Security Academy', 'OWASP WebGoat', 'None of these'])
    .showOtherOption(true);

  // ---------------------------------------------------------------- the session
  form.addPageBreakItem().setTitle('Your session');
  form.addMultipleChoiceItem()
    .setTitle('What did you use?')
    .setChoiceValues(['Laptop or desktop', 'Tablet', 'Phone'])
    .setRequired(true);
  form.addMultipleChoiceItem()
    .setTitle('Roughly how long did you play?')
    .setChoiceValues(['Under 10 minutes', '10–20 minutes', '20–40 minutes', 'Over 40 minutes'])
    .setRequired(true);
  form.addCheckboxItem()
    .setTitle('How far did you get? (tick everything you reached)')
    .setChoiceValues([
      'The welcome page',
      'A lesson (briefing file)',
      'My first ticket',
      'Three or more tickets',
      'The Aurora Breach (capstone)',
    ])
    .setRequired(true);
  form.addTextItem()
    .setTitle('Your CyberShield handle (optional)')
    .setHelpText('Only if you are happy for this feedback to be read alongside what you did in the game. Not your real name.');

  // ---------------------------------------------------------------- getting started
  form.addPageBreakItem().setTitle('Getting started');
  form.addGridItem()
    .setTitle('How much do you agree?')
    .setRows([
      'The welcome page made it clear what to do',
      'The lessons were easy to follow',
      'The "see it happen" demos helped me understand the attack',
      'The guided fix helped before trying a ticket on my own',
      'The lesson amount felt right, not overwhelming',
    ])
    .setColumns(AGREE5)
    .setRequired(true);

  // ---------------------------------------------------------------- tickets
  form.addPageBreakItem().setTitle('The tickets');
  form.addMultipleChoiceItem()
    .setTitle('How difficult were the tickets?')
    .setChoiceValues(['Too easy', 'A bit easy', 'About right', 'A bit hard', 'Too hard'])
    .setRequired(true);
  form.addGridItem()
    .setTitle('How much do you agree?')
    .setRows([
      'I understood what each ticket was asking me to do',
      'When I got it wrong, the feedback told me why',
      'I understood the two checks (attack suite and functional suite)',
      'The hints were useful',
      'The story and characters made it more engaging',
      "XP, badges and Aurora's security score made me want to keep going",
    ])
    .setColumns(AGREE5)
    .setRequired(true);
  form.addCheckboxItem()
    .setTitle('Which kinds of ticket did you enjoy? (tick all that apply)')
    .setChoiceValues([
      'Spot the flaw (point at the line)',
      'Patch the code',
      'Review a colleague\'s fix',
      'Harden the configuration',
      'The Aurora Breach (capstone)',
      'I did not try any',
    ]);

  // ---------------------------------------------------------------- SUS
  // The System Usability Scale (Brooke, 1996), unchanged so scores compare with
  // the published benchmark of 68. Odd items are positive, even items negative;
  // scoring is done in the analysis, not here.
  form.addPageBreakItem()
    .setTitle('Overall usability')
    .setHelpText('Ten standard questions. Answer each quickly; your first reaction is what matters. "The system" means CyberShield Academy.');
  form.addGridItem()
    .setTitle('How much do you agree with each statement?')
    .setRows([
      'I think that I would like to use this system frequently.',
      'I found the system unnecessarily complex.',
      'I thought the system was easy to use.',
      'I think that I would need the support of a technical person to be able to use this system.',
      'I found the various functions in this system were well integrated.',
      'I thought there was too much inconsistency in this system.',
      'I would imagine that most people would learn to use this system very quickly.',
      'I found the system very cumbersome to use.',
      'I felt very confident using the system.',
      'I needed to learn a lot of things before I could get going with this system.',
    ])
    .setColumns(['1 Strongly disagree', '2', '3', '4', '5 Strongly agree'])
    .setRequired(true);

  // ---------------------------------------------------------------- problems
  form.addPageBreakItem().setTitle('Problems and ideas');
  form.addMultipleChoiceItem()
    .setTitle('Did anything break, freeze or behave strangely?')
    .setChoiceValues(['No', 'Yes'])
    .setRequired(true);
  form.addParagraphTextItem()
    .setTitle('If yes, what happened? (what you were doing, what you expected, what you saw)');
  form.addParagraphTextItem().setTitle('What did you like most?');
  form.addParagraphTextItem().setTitle('What was confusing or frustrating?');
  form.addParagraphTextItem().setTitle('If you could change one thing, what would it be?');
  form.addScaleItem()
    .setTitle('How likely are you to recommend CyberShield Academy to someone learning web security?')
    .setBounds(0, 10)
    .setLabels('Not at all likely', 'Extremely likely');
  form.addParagraphTextItem().setTitle('Anything else?');

  // ---------------------------------------------------------------- responses
  const sheet = SpreadsheetApp.create('CyberShield Academy: playtest responses');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());

  Logger.log('Share this link with testers: ' + form.getPublishedUrl());
  Logger.log('Edit the form here:          ' + form.getEditUrl());
  Logger.log('Responses go to this Sheet:  ' + sheet.getUrl());
}
