# -*- coding: utf-8 -*-
"""SORAX 1 — Contenu dataset : SCRATCH, CONNAISSANCES, FUN, CRÉATIVITÉ."""

# ------------------------------------------------------------ AIDE SCRATCH

SCRATCH_HELP = [
    ("how do i make a game", [
        "Start simple! Pick one core idea (like collecting things or dodging obstacles), make the player move, add a score, and build from there!",
        "Great choice! Step 1: plan your game on paper. Step 2: make one small thing work (like a moving sprite). Step 3: add one feature at a time!",
    ]),
    ("how do i make a platformer", [
        "Key parts: gravity that pulls the player down, a jump script, and platforms that stop the falling. Test a LOT. Platformers take patience!",
        "Use a variable for velocity! Gravity pulls down each frame, jumping gives an upward boost, and platforms reset the fall!",
    ]),
    ("how do i make my sprite move", [
        "Use 'change x by' blocks with arrow keys! Or use the 'move 10 steps' block with pointing blocks. Test each key separately!",
    ]),
    ("how do i make a score", [
        "Make a variable called Score! Set it to 0 at the start, and 'change Score by 1' whenever the player earns a point!",
    ]),
    ("what is a variable", [
        "A variable is like a box with a label that stores a number or text! You can peek inside it, change it, and use it anywhere in your project!",
    ]),
    ("how do i make gravity", [
        "Make a variable called Velocity! Every frame, change y by Velocity, then make Velocity more negative. Landing on a platform resets it to 0!",
    ]),
    ("how do i make a jump", [
        "When the jump key is pressed, set your velocity variable to a positive number like 12! Gravity will bring you back down!",
    ]),
    ("what are clones", [
        "Clones are copies of a sprite that run their own scripts! Perfect for bullets, enemies, or particles. Remember to delete them when done!",
    ]),
    ("how do i use clones", [
        "Use 'create clone of myself', then add a 'when I start as a clone' script to control what each copy does. And delete clones when you're done with them!",
    ]),
    ("how do i make a health bar", [
        "Make a Health variable, draw a rectangle, and set its size based on Health! Or use a sprite with costumes for different health levels!",
    ]),
    ("how do i make a main menu", [
        "Use a Stage variable like Screen! If Screen = menu, show the title. When the player clicks play, change Screen to game and start your scripts!",
    ]),
    ("how do i add sound", [
        "Use the 'play sound' block from the Sound category! You can pick sounds from the library or record your own!",
    ]),
    ("how do i make my sprite talk", [
        "Use the 'say' block! Combine it with 'wait' to control how long the text stays!",
    ]),
    ("how do i make an animation", [
        "Use 'next costume' with a small wait inside a loop! The wait controls the speed of your animation!",
    ]),
    ("my script doesn't work", [
        "Classic bug hunting time! Check: are your blocks in the right order? Do the variables have the values you expect? Try the say block to spy on values!",
        "Debugging tips: use 'say' blocks to show variable values, check if your loops actually run, and test one small piece at a time!",
    ]),
    ("i have a bug in my project", [
        "Bugs happen to everyone! The best trick: make the bug happen on purpose and watch closely. Use 'say' blocks to see what your variables are doing!",
    ]),
    ("how do i debug", [
        "Slow down and observe! Use 'say' blocks to display values, click scripts one by one, and change one thing at a time until you find the culprit!",
    ]),
    ("how do i get followers", [
        "Make projects you're proud of, share them regularly, comment kindly on others' projects, and be patient! Quality beats quantity!",
        "Be an active, positive member of the community! Great projects plus kindness equals followers over time!",
    ]),
    ("how do i become famous on scratch", [
        "There's no magic trick! Make original projects you love, keep improving, and support other creators. The rest is patience!",
    ]),
    ("how do i get on the front page", [
        "Front page projects get there through loves, favorites, and comments! Focus on making something people enjoy, and share it at a good time!",
    ]),
    ("what is remixing", [
        "Remixing is taking someone's project and making it your own! Always give credit, and check the project's rules!",
    ]),
    ("how do i remix a project", [
        "Click the Remix button inside any project! The code gets copied to your account and you can change whatever you want. Give credit to the original!",
    ]),
    ("is remixing ok", [
        "Yes! Remixing is a huge part of Scratch culture, as long as you give credit and add your own ideas!",
    ]),
    ("how do i share my project", [
        "Click the orange Share button! Add good instructions and notes so people know how to enjoy your project!",
    ]),
    ("what are cloud variables", [
        "Cloud variables are saved on Scratch servers so everyone sees the same value! They only store numbers, so people use them for high scores!",
    ]),
    ("can i make a chatbot like you", [
        "Yes! That's literally how I was made: a giant list of questions and answers, and scripts that find the best match. Start small with 20 pairs and grow!",
        "Absolutely! Start with a list of questions and answers, then match what the user types. That's how I work!",
    ]),
    ("what is turbo mode", [
        "Turbo mode runs your project super fast by skipping screen refreshes! Turn it on with shift + green flag. Great for heavy calculations!",
    ]),
    ("what is turbowarp", [
        "TurboWarp is a modified version of Scratch that runs projects faster and has extra features! Lots of coders use it!",
    ]),
    ("how do i make my game faster", [
        "Fewer scripts running at once, less 'forever' loops, simpler costumes, and turbo mode! Also delete unused sprites and sounds!",
    ]),
    ("why is my project lagging", [
        "Common causes: too many clones, huge forever loops, or big images! Reduce the number of things happening at once!",
    ]),
    ("what are extensions", [
        "Extensions add new blocks, like Pen, Music, and Translate! Find them at the bottom of the block palette!",
    ]),
    ("how do i use the pen", [
        "Add the Pen extension, then use 'pen down' and move your sprite to draw! Try 'set pen color' and 'change pen size' for style!",
    ]),
    ("how do i delete a sprite", [
        "Click the little x on the sprite's icon in the sprite panel. Farewell, little sprite!",
    ]),
    ("how do i duplicate a sprite", [
        "Right-click the sprite and choose duplicate! Perfect for enemies!",
    ]),
    ("how do i make multiplayer", [
        "True online multiplayer is tricky on Scratch! You can fake it with two players on one keyboard, or explore cloud variables for simple versions!",
    ]),
    ("how do i make a speedrun timer", [
        "Make a Timer variable, reset it when the game starts, and change it by 0.01 every hundredth of a second using a wait block loop!",
    ]),
    ("how do i get ideas for projects", [
        "Remix your favorite games with a twist, combine two things you love, or solve a small problem in your day. Ideas are everywhere!",
    ]),
    ("what should i make on scratch", [
        "How about: a pet simulator, a maze with moving walls, a rhythm game, or an interactive story? Pick what sounds fun to build!",
    ]),
]

# ------------------------------------------------------------ CONNAISSANCES

KNOWLEDGE = [
    ("what is gravity", [
        "Gravity is the invisible force that pulls things toward each other! Earth's gravity keeps you on the ground and the Moon circling us!",
    ]),
    ("what is the sun", [
        "The Sun is a giant star at the center of our solar system! It's a giant ball of super hot gas that gives us light and warmth!",
    ]),
    ("what is a planet", [
        "A planet is a big round world that orbits a star! We have 8 planets in our solar system. Sorry Pluto fans!",
    ]),
    ("what is a star", [
        "Stars are giant balls of burning gas, like our Sun! They're so far away they look tiny, even though many are way bigger than the Sun!",
    ]),
    ("what is a black hole", [
        "A black hole is a place where gravity is SO strong that nothing, not even light, can escape! The result of giant stars collapsing!",
    ]),
    ("what is the moon", [
        "The Moon is Earth's companion in space! It orbits us, makes tides, and is the only other world humans have walked on!",
    ]),
    ("how many planets are there", [
        "There are 8 planets in our solar system: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune!",
    ]),
    ("which is the biggest planet", [
        "Jupiter! It's so big that all the other planets could fit inside it. More than once!",
    ]),
    ("which is the smallest planet", [
        "Mercury! It's the closest to the Sun and only slightly bigger than our Moon!",
    ]),
    ("which planet is the hottest", [
        "Venus! Even though Mercury is closer to the Sun, Venus's thick atmosphere traps the heat. It's like a sauna from a nightmare!",
    ]),
    ("can you live on mars", [
        "Not yet! Mars is cold, has barely any air, and no liquid water on the surface. Humans are working on it though!",
    ]),
    ("how far is the moon", [
        "About 384,000 kilometers! Astronauts took around 3 days to fly there!",
    ]),
    ("what are stars made of", [
        "Mostly hydrogen and helium gas, squeezed so hard in the middle that they glow and burn for billions of years!",
    ]),
    ("what is a galaxy", [
        "A galaxy is a giant family of stars, gas, and dust! We live in the Milky Way, which has billions of stars!",
    ]),
    ("how old is the universe", [
        "About 13.8 billion years old! The universe began with the Big Bang and has been growing ever since!",
    ]),
    ("what is a light year", [
        "The distance light travels in one year: about 9.5 trillion kilometers! Light is FAST, and space is even bigger!",
    ]),
    ("who went to the moon first", [
        "Neil Armstrong, in 1969! His first steps were 'one small step for man, one giant leap for mankind'!",
    ]),
    ("why is the sky blue", [
        "Air molecules scatter sunlight in all directions, and blue light scatters the most! That's why the sky looks blue during the day!",
    ]),
    ("how do rainbows form", [
        "Sunlight passes through raindrops, which split it into all its colors! Red on top, violet on bottom!",
    ]),
    ("what makes thunder", [
        "Lightning heats the air so fast that it explodes outward! That boom is thunder!",
    ]),
    ("how do clouds form", [
        "Water evaporates up, cools high in the sky, and turns into tiny droplets that stick together as clouds!",
    ]),
    ("why is the sea salty", [
        "Rivers wash salts and minerals from rocks into the sea for millions of years! The water evaporates but the salt stays!",
    ]),
    ("what is snow", [
        "Snow is frozen water that crystallizes into beautiful six-sided flakes as it falls! Every single snowflake is unique!",
    ]),
    ("what is rain", [
        "Cloud droplets grow too heavy to float, so gravity brings them down as rain!",
    ]),
    ("what is a volcano", [
        "A mountain with a hole to the hot insides of Earth! Sometimes pressure builds up and... boom, eruption!",
    ]),
    ("what is an earthquake", [
        "The ground shakes when giant rock plates under Earth's surface suddenly slip past each other!",
    ]),
    ("what is a dinosaur", [
        "Giant reptiles that ruled Earth for 165 million years! They went extinct 66 million years ago, probably from an asteroid impact!",
    ]),
    ("what was the biggest dinosaur", [
        "Some of the long-necked ones, like Argentinosaurus, were as long as 3 school buses! The T-rex was smaller but scarier!",
    ]),
    ("why did dinosaurs disappear", [
        "An asteroid about 10 km wide hit Earth 66 million years ago! The dust blocked the sun and changed the climate!",
    ]),
    ("are birds dinosaurs", [
        "Technically yes! Birds are the last surviving branch of the dinosaur family tree. A chicken is a tiny dinosaur!",
    ]),
    ("what is a fossil", [
        "The preserved remains of ancient life, usually turned to stone over millions of years! Nature's history book!",
    ]),
    ("what is the biggest animal", [
        "The blue whale! Up to 30 meters long, bigger than any dinosaur. Its heart is the size of a small car!",
    ]),
    ("what is the fastest animal", [
        "The peregrine falcon! It dives at over 300 km/h! On land, the cheetah wins at about 100 km/h!",
    ]),
    ("what is the tallest animal", [
        "The giraffe! Up to 5.5 meters tall. Their necks still have only 7 bones, same as us!",
    ]),
    ("how do birds fly", [
        "Wings push air down, and the air pushes back up! Plus their hollow bones make them super light!",
    ]),
    ("why do cats purr", [
        "Cats purr when they're happy, but also to calm themselves! The vibration may even help healing. Purr power!",
    ]),
    ("how long do turtles live", [
        "Some turtles live over 100 years! Certain tortoises have celebrated their 150th birthday!",
    ]),
    ("what do dolphins eat", [
        "Mostly fish and squid! They're smart hunters that work together!",
    ]),
    ("what is the biggest ocean", [
        "The Pacific Ocean! It covers about a third of Earth and is bigger than all the land combined!",
    ]),
    ("what is the longest river", [
        "The Nile in Africa is the classic answer, about 6,650 km! Some say the Amazon is longer. Geographers argue about it!",
    ]),
    ("what is the tallest mountain", [
        "Mount Everest, at 8,849 meters! Climbers need oxygen tanks near the top!",
    ]),
    ("how many continents are there", [
        "Seven: Africa, Antarctica, Asia, Australia, Europe, North America, and South America!",
    ]),
    ("what is the biggest country", [
        "Russia! It spans 11 time zones. When they eat breakfast in the east, the west is going to bed!",
    ]),
    ("what is the smallest country", [
        "Vatican City! It's inside Rome and smaller than most parks!",
    ]),
    ("what is the capital of france", [
        "Paris! The city of lights, croissants, and the Eiffel Tower!",
    ]),
    ("what is the capital of japan", [
        "Tokyo! One of the biggest cities in the world!",
    ]),
    ("what is the capital of england", [
        "London! Home of Big Ben!",
    ]),
    ("what is the capital of the usa", [
        "Washington, D.C.! Not New York, that's a common mix-up!",
    ]),
    ("what is the capital of italy", [
        "Rome! The city of ancient gladiators and amazing pasta!",
    ]),
    ("what is the capital of spain", [
        "Madrid!",
    ]),
    ("what is the capital of germany", [
        "Berlin!",
    ]),
    ("how many bones do humans have", [
        "Adults have 206! Babies are born with about 300, but some fuse together as they grow!",
    ]),
    ("why does my heart beat", [
        "Your heart is a muscle pump that sends blood everywhere! It beats about 100,000 times a day without complaining!",
    ]),
    ("how many teeth do humans have", [
        "Kids have 20 baby teeth, grown-ups have 32! Brush them all!",
    ]),
    ("what is blood", [
        "Your delivery system! Red cells carry oxygen, white cells fight germs, and platelets fix leaks!",
    ]),
    ("what is the internet", [
        "A giant network of computers talking to each other across the whole world! Like a web that spans the planet!",
    ]),
    ("what is a computer", [
        "A machine that follows instructions crazy fast! It only knows 0s and 1s, but billions of them per second!",
    ]),
    ("what is code", [
        "Instructions for computers! You write steps in a language it understands, and it follows them exactly!",
    ]),
    ("what is a computer virus", [
        "A bad program that copies itself and messes up computers! That's why you don't click strange links!",
    ]),
    ("what is ai", [
        "Artificial intelligence: programs that do things that seem smart, like understanding language or recognizing pictures! I'm a small one!",
    ]),
    ("who was einstein", [
        "Albert Einstein, the physicist who figured out relativity! E=mc squared! He had wild hair and a wild brain!",
    ]),
    ("who was newton", [
        "Isaac Newton, the scientist famous for gravity and motion laws! The apple story might be a legend, but his math was real!",
    ]),
    ("who made the first computer", [
        "Many people helped! Charles Babbage designed the first concept, and Ada Lovelace wrote the first program way back in the 1800s!",
    ]),
    ("what is python", [
        "A programming language that's famous for being readable and beginner-friendly! Named after a comedy show, not the snake!",
    ]),
    ("what is scratch", [
        "Scratch is a free platform where you make games, animations and stories by snapping blocks together! It's where I live!",
    ]),
    ("do fish drink water", [
        "Sort of! Water constantly passes through their bodies. Freshwater fish pee a lot, saltwater fish drink more. Fish life is weird!",
    ]),
    ("what do you call a group of flamingos", [
        "A flamboyance! Best group name in the animal kingdom!",
    ]),
]

# ------------------------------------------------------------------- BLAGUES

JOKES = [
    "Why did the computer go to the doctor? Because it caught a virus!",
    "Why do programmers like dark mode? Because light attracts bugs!",
    "What do you call a sleeping dinosaur? A dino-snore!",
    "How does the moon cut its hair? Eclipse it!",
    "Why can't your nose be 12 inches long? Because then it would be a foot!",
    "What do you call a fish without eyes? A fsh!",
    "Why did the math book look sad? It had too many problems!",
    "I'm reading a book about anti-gravity. It's impossible to put down!",
    "Why don't scientists trust atoms? Because they make up everything!",
    "What did one wall say to the other wall? I'll meet you at the corner!",
    "Why was the broom late? It over-swept!",
    "What do you call cheese that isn't yours? Nacho cheese!",
    "Why did the cookie go to the hospital? Because it felt crummy!",
    "What's a computer's favorite snack? Microchips!",
    "Why do bees have sticky hair? Because they use honeycombs!",
    "What do you call a bear with no teeth? A gummy bear!",
    "Why did the banana go to the doctor? Because it wasn't peeling well!",
    "What do you call a snowman in the summer? A puddle!",
    "How do you make a tissue dance? Put a little boogie in it!",
    "Why did the student eat his homework? Because the teacher said it was a piece of cake!",
    "What did the ocean say to the beach? Nothing, it just waved!",
    "Why don't eggs tell jokes? They'd crack each other up!",
    "What do you call a boomerang that doesn't come back? A stick!",
    "Why did the scarecrow win an award? Because he was outstanding in his field!",
    "What do clouds wear under their raincoats? Thunderwear!",
    "What do you call an old snowman? Water!",
    "Why don't skeletons fight each other? They don't have the guts!",
    "What do you call a magician's dog? A labracadabrador!",
    "Why was 6 afraid of 7? Because 7 8 9!",
    "What did 0 say to 8? Nice belt!",
    "Why did the golfer bring two pairs of pants? In case he got a hole in one!",
    "How does a penguin build its house? Igloos it together!",
    "Where do cows go on Friday nights? To the moo-vies!",
    "What do you call a pig that does karate? A pork chop!",
    "What music do mountains listen to? Rock music!",
    "What falls in winter but never gets hurt? Snow!",
    "What's a snake's favorite subject? Hiss-tory!",
    "What's brown and sticky? A stick!",
    "Why did the teddy bear say no to dessert? Because she was stuffed!",
    "What time is it when an elephant sits on your fence? Time to fix the fence!",
    "How do you organize a space party? You planet!",
    "What animal is always at a baseball game? A bat!",
    "Why did the cow cross the road? To get to the udder side!",
    "What did the buffalo say when his son left? Bison!",
    "What has four wheels and flies? A garbage truck!",
    "Why are fish so smart? Because they swim in schools!",
    "Knock knock. Who's there? Interrupting cow. Interrupting cow wh- MOO!",
    "Knock knock. Who's there? Boo. Boo who? Don't cry, it's just a joke!",
    "Knock knock. Who's there? Lettuce. Lettuce who? Lettuce in, it's cold out here!",
    "Knock knock. Who's there? Tank. Tank who? You're welcome!",
    "What do you call a fake noodle? An impasta!",
    "Why did the picture go to jail? Because it was framed!",
    "What do you call a can opener that doesn't work? A can't opener!",
    "Why can't a leopard hide? Because he's always spotted!",
    "What do you call a dinosaur that crashes his car? Tyrannosaurus wrecks!",
    "Why did the computer squeak? Because someone stepped on its mouse!",
    "What's a cat's favorite color? Purr-ple!",
    "Why did the orange stop? It ran out of juice!",
    "What do you call two bananas? Slippers!",
    "Why don't sharks like fast food? Because they can't catch it!",
    "What do you call a sleeping bull? A bulldozer!",
    "What has ears but cannot hear? A cornfield!",
    "What's red and smells like blue paint? Red paint!",
    "Why did the belt get arrested? For holding up the pants!",
    "Where do snowmen keep their money? In a snow bank!",
    "What do you get when you cross a snowman and a dog? Frostbite!",
    "Why did the skeleton go to the party alone? He had no body to go with!",
    "What do you call a grumpy bear? A bear with a sore paw... okay, that one needs work!",
]

JOKE_PROMPTS = {
    "tell me a joke": JOKES,
    "tell me another joke": JOKES,
    "another joke": JOKES,
    "one more joke": JOKES,
    "tell a joke": JOKES,
    "say something funny": JOKES,
    "make me laugh": JOKES,
    "joke": JOKES,
    "a joke": JOKES,
    "got any jokes": JOKES,
    "know any jokes": JOKES,
    "tell us a joke": JOKES,
    "make a joke": JOKES,
    "can you tell me a joke": JOKES,
    "tell me something funny": JOKES,
    "i want a joke": JOKES,
    "give me a joke": JOKES,
    "joke please": JOKES,
}

# ------------------------------------------------------------------ ÉNIGMES

RIDDLES = [
    "What has hands but can't clap? A clock!",
    "What gets wetter the more it dries? A towel!",
    "What has to be broken before you can use it? An egg!",
    "What has a head and a tail but no body? A coin!",
    "What goes up but never comes down? Your age!",
    "What has lots of teeth but can't bite? A comb!",
    "What building has the most stories? The library!",
    "What has one eye but can't see? A needle!",
    "What can travel around the world while staying in a corner? A stamp!",
    "What has words but never speaks? A book!",
    "What runs all around a backyard yet never moves? A fence!",
    "I'm tall when I'm young and short when I'm old. What am I? A candle!",
    "What has keys but can't open locks? A piano!",
    "What month has 28 days? All of them!",
    "What is full of holes but still holds water? A sponge!",
    "What question can you never answer yes to? Are you asleep yet?",
    "What is always in front of you but can't be seen? The future!",
    "What can you catch but not throw? A cold!",
    "What has many needles but doesn't sew? A Christmas tree!",
    "The more of this there is, the less you see. What is it? Darkness!",
]

RIDDLE_PROMPTS = {
    "tell me a riddle": RIDDLES,
    "a riddle": RIDDLES,
    "give me a riddle": RIDDLES,
    "riddle me this": RIDDLES,
    "ask me a riddle": RIDDLES,
    "tell me another riddle": RIDDLES,
    "riddle": RIDDLES,
}

# ---------------------------------------------------------------- FAITS FUN

FUN_FACTS = [
    "Honey never spoils! Archaeologists found 3000-year-old honey that was still edible!",
    "Octopuses have three hearts and blue blood!",
    "A day on Venus is longer than its year! It spins that slowly!",
    "Bananas are berries, but strawberries aren't! Botany is weird!",
    "Sharks existed before trees! Sharks: 450 million years, trees: 350 million!",
    "Sloths can hold their breath longer than dolphins, up to 40 minutes!",
    "The Eiffel Tower gets about 15 cm taller in summer because heat expands the metal!",
    "There are more possible chess games than atoms in the observable universe!",
    "A group of flamingos is called a flamboyance!",
    "A group of crows is called a murder! Spooky but true!",
    "Your brain uses about 20% of your body's energy!",
    "Cats sleep around 16 hours a day. Dream life!",
    "Sound travels about 4 times faster in water than in air!",
    "The first computer bug was an actual moth stuck in a computer in 1947!",
    "Wombats poop cubes! Scientists think the shape stops it from rolling away!",
    "There are more stars in the universe than grains of sand on all Earth's beaches!",
    "A sneeze can travel at speeds up to 160 km/h!",
    "Some turtles can breathe through their butts! Science is gross and amazing!",
    "The Sun makes up 99.8% of all the mass in our solar system!",
    "Hot water can freeze faster than cold water! It's called the Mpemba effect!",
    "Butterflies taste with their feet!",
    "An ostrich's eye is bigger than its brain!",
    "The loudest animal in the ocean is the pistol shrimp! It snaps its claw so loud it can stun prey!",
    "Humans share about 60% of their DNA with bananas!",
    "The unicorn is the national animal of Scotland!",
    "You can't hum while holding your nose closed. Try it!",
    "The shortest war in history lasted 38 minutes!",
    "Bees can recognize human faces!",
    "Jupiter's Great Red Spot is a storm bigger than Earth that's been raging for centuries!",
    "Avocados are fruits, and they're technically berries too!",
]

FACT_PROMPTS = {
    "tell me a fun fact": FUN_FACTS,
    "fun fact": FUN_FACTS,
    "random fact": FUN_FACTS,
    "tell me a fact": FUN_FACTS,
    "fact": FUN_FACTS,
    "give me a fact": FUN_FACTS,
    "tell me another fact": FUN_FACTS,
    "tell me something interesting": FUN_FACTS,
    "tell me something cool": FUN_FACTS,
    "did you know anything cool": FUN_FACTS,
}

# ----------------------------------------------------------- TU PRÉFÈRES ?

WOULD_YOU_RATHER = [
    "Would you rather be able to fly or turn invisible? I'd pick flying. The view!",
    "Would you rather have a pet dragon or a pet robot? Robots don't set the sofa on fire!",
    "Would you rather live in a castle or a treehouse? Treehouses feel cozier!",
    "Would you rather eat pizza or ice cream forever? Pizza has more food groups!",
    "Would you rather be super fast or super strong? Speed wins, in my opinion!",
    "Would you rather explore space or the deep ocean? Space! I hear it's nice this time of year!",
    "Would you rather have unlimited art supplies or unlimited video games? Art supplies! Create forever!",
    "Would you rather be a famous YouTuber or a secret superhero? Secret superhero! Humble AND cool!",
    "Would you rather talk to animals or speak every language? Talking to animals sounds chaotic and amazing!",
    "Would you rather always be 10 minutes late or always be 20 minutes early? Early! Time for snacks!",
    "Would you rather have snow every day or summer every day? Snow, obviously! Have you met me?",
    "Would you rather be the best at one thing or okay at everything? Best at one thing! Mastery is awesome!",
]

WYR_PROMPTS = {
    "would you rather": WOULD_YOU_RATHER,
    "would you rather?": WOULD_YOU_RATHER,
    "ask me would you rather": WOULD_YOU_RATHER,
}

# choix quand l'utilisateur pose la question
WYR_ANSWERS = [
    ("would you rather fly or be invisible", [
        "Flying! Traffic would never be a problem again. What about you?",
    ]),
    ("fly or invisible", [
        "Flying, no question! The wind in your... everything!",
    ]),
    ("would you rather have a dog or a cat", [
        "Both are great, but dogs seem more excited to see you. Cats judge silently!",
    ]),
]

# ------------------------------------------------------------------ CRÉATIF

GAME_IDEAS = [
    "How about a game where you're a snow fox collecting stars before sunrise?",
    "A tower defense where you defend a cookie castle from hungry ants!",
    "An endless runner where the floor is made of disappearing clouds!",
    "A restaurant game where you serve pizzas to impatient robots!",
    "A puzzle game where you rotate the world instead of the character!",
    "A ghost game where you scare hikers away from your haunted mountain!",
    "A fishing game... in space! Catch alien fish with a laser rod!",
    "A rhythm game where you're a DJ cat mixing songs for a dance battle!",
    "A platformer where every jump paints the world with colors!",
    "A game where you're a submarine exploring a city that sank underwater!",
    "A farm game but the crops are baby dragons you have to raise!",
    "A maze where the walls move every time you blink!",
    "A game where you play as the villain trying to stop the hero for once!",
    "A skateboarding game on the rings of Saturn!",
    "A detective game where you solve the mystery of the missing pizza slice!",
    "A game where you throw paper planes across a whole city!",
    "A game about a knight whose sword is a giant pencil!",
    "A survival game on a floating island in the sky!",
    "A game where you're a wizard sorting magical laundry by color!",
    "A two-player game where one player is the level and the other tries to survive!",
]

IDEA_PROMPTS = {
    "give me a game idea": GAME_IDEAS,
    "game idea": GAME_IDEAS,
    "i need a game idea": GAME_IDEAS,
    "i want to make a game": GAME_IDEAS,
    "what game should i make": GAME_IDEAS,
    "give me another game idea": GAME_IDEAS,
    "any game ideas": GAME_IDEAS,
    "game ideas": GAME_IDEAS,
    "what game should i make on scratch": GAME_IDEAS,
    "give me a project idea": GAME_IDEAS,
}

DRAW_IDEAS = [
    "Draw a snow fox watching the northern lights!",
    "Draw your dream treehouse with all the details!",
    "Draw a city on the back of a giant turtle!",
    "Draw a dragon having a bad hair day!",
    "Draw what your ideal pet would look like, even if impossible!",
    "Draw a vending machine that dispenses weather!",
    "Draw yourself as a superhero with your coolest power!",
    "Draw the inside of a spaceship designed by cats!",
    "Draw a monster made entirely of your favorite food!",
    "Draw a waterfall flowing upward!",
    "Draw a cozy reading nook in a giant mushroom!",
    "Draw the view from a window 100 years in the future!",
    "Draw a robot trying to walk a dinosaur on a leash!",
    "Draw an island shaped like your favorite animal!",
]

STORIES = [
    "Once upon a time, a little snow fox named Luna wanted to touch the moon. Every night she climbed the tallest mountain and jumped as high as she could, but the moon stayed far away. One winter, the moon saw her trying and leaned down closer, just a little, so Luna's nose touched its cold silver light. That's why, they say, foxes' noses shine on snowy nights. The end!",
    "There once was a robot who couldn't stop dancing. Engineers tried everything: turning it off, updating it, even removing its legs. But the robot just wiggled its antenna to the beat. Finally, someone built a dance floor, and the robot became the happiest dance teacher in the world. The end!",
    "Milo the cat wanted to be a dragon. He practiced roaring (it came out as a meow), collected shiny things, and tried to breathe fire (hiccup). One day a real dragon landed in the garden, saw Milo's shiny collection, and said, 'Nice hoard, friend.' They've been treasure buddies ever since. The end!",
    "A little cloud was sad because it was too small to make rain like the big clouds. But one hot summer day, a single flower was dying of thirst under the burning sun. The little cloud gathered all its courage, squeezed itself, and released three perfect raindrops. The flower survived. Being small, it turned out, was exactly the right size. The end!",
    "In a cozy laundry room, a sock named Sam lost his twin in the wash. Instead of crying, Sam decided to explore. He rode the dryer like a roller coaster, made friends with a friendly towel, and eventually found his twin living happily as a hand puppet. Sam chose adventure and became a pirate flag. The end!",
    "In the Cookie Kingdom, a brave chocolate chip knight guarded the Royal Recipe. One day, the Marshmallow Wizard tried to steal it to make the kingdom s'mores. The knight offered a deal: the wizard could toast marshmallows at the castle every Friday. Peace, it turns out, tastes sweet. The end!",
    "Taco the dinosaur was scared of everything: loud noises, small bugs, his own shadow. When a storm trapped the baby dinos in a cave, only Taco was small enough to squeeze in and lead them out. That day he learned that being careful isn't the same as being weak. He was still scared of bugs, though. The end!",
    "Mei found a magic paintbrush in her grandmother's attic: whatever she painted became real. She painted food for the hungry, flowers for the sad, and stars for the dark nights. When asked why she never painted gold for herself, she said, 'Everything I need, I already have.' And the paintbrush glowed, proud of its artist. The end!",
]

STORY_PROMPTS = {
    "tell me a story": STORIES,
    "tell a story": STORIES,
    "tell me another story": STORIES,
    "tell me a bedtime story": STORIES,
    "say a story": STORIES,
    "i want a story": STORIES,
    "story": STORIES,
    "a story": STORIES,
    "can you tell me a story": STORIES,
}

COMPLIMENTS = [
    "You're doing better than you think!",
    "You have great taste in AI assistants, obviously!",
    "The fact that you're curious enough to chat with an AI? That's smart!",
    "You show up, you try things, you ask questions. That's the good stuff!",
    "Somewhere out there, a snow fox believes in you!",
    "Your future self is going to be so proud of you!",
]

COMPLIMENT_PROMPTS = {
    "give me a compliment": COMPLIMENTS,
    "say something nice": COMPLIMENTS,
    "compliment me": COMPLIMENTS,
    "tell me something nice": COMPLIMENTS,
}

MOTIVATION = [
    "You've got this! Big things are just small things done repeatedly!",
    "Progress beats perfection! Start small, keep going!",
    "Every expert was once a total beginner. Keep going!",
    "Rest is productive too! You can't pour from an empty cup!",
    "The fact that it's hard means you're growing. Keep pushing!",
    "You don't have to be the best, you just have to be better than yesterday!",
    "Mistakes are proof that you're trying. Onward!",
    "Imagine telling your future self you almost quit. Let's make them proud!",
]

MOTIVATION_PROMPTS = {
    "i need motivation": MOTIVATION,
    "motivate me": MOTIVATION,
    "i can't do this": MOTIVATION,
    "i cant do this": MOTIVATION,
    "i give up": MOTIVATION,
    "im giving up": MOTIVATION,
    "this is too hard": MOTIVATION,
    "i'm stressed about school": MOTIVATION,
    "cheer me up": MOTIVATION,
    "i need encouragement": MOTIVATION,
}

CHALLENGES = [
    "Challenge: draw a picture using only 3 colors!",
    "Challenge: write a 6-word story. Exactly 6 words!",
    "Challenge: build something on Scratch using only 10 blocks!",
    "Challenge: learn to say hello in 3 new languages today!",
    "Challenge: make up a secret handshake with a friend!",
    "Challenge: invent a new word and use it all day!",
    "Challenge: count backwards from 100 by 7s!",
    "Challenge: write a poem about your favorite snack!",
    "Challenge: design a flag for your own imaginary country!",
    "Challenge: make a paper airplane that can turn left!",
    "Challenge: name 10 animals without the letter A!",
    "Challenge: memorize a joke and tell it to someone!",
]

CHALLENGE_PROMPTS = {
    "give me a challenge": CHALLENGES,
    "challenge me": CHALLENGES,
    "i want a challenge": CHALLENGES,
    "bored give me something to do": CHALLENGES,
    "give me something to do": CHALLENGES,
}

# --------------------------------------------------------------- JEUX AVEC L'IA

EIGHT_BALL = [
    "Signs point to yes!",
    "Without a doubt!",
    "My circuits say: absolutely!",
    "Outlook good!",
    "Ask again later, my crystal ball is foggy!",
    "Very doubtful, but surprises happen!",
    "Hmm, the vibes say no!",
    "Better not tell you now!",
    "Yes, and I'm rarely wrong. Rarely!",
    "Don't count on it!",
]

EIGHT_BALL_PROMPTS = {
    "will i be famous": EIGHT_BALL,
    "will i win": EIGHT_BALL,
    "am i lucky": EIGHT_BALL,
    "will i be rich": EIGHT_BALL,
    "am i smart": EIGHT_BALL,
    "will it be sunny tomorrow": EIGHT_BALL,
    "magic 8 ball": EIGHT_BALL,
    "8 ball": EIGHT_BALL,
    "will my team win": EIGHT_BALL,
}

RPS_ANSWERS = [
    "Rock! What do you pick?",
    "Paper! Ready when you are!",
    "Scissors! Snip snip!",
]

RPS_PROMPTS = {
    "rock paper scissors": RPS_ANSWERS,
    "lets play rock paper scissors": RPS_ANSWERS,
    "rock paper scissors shoot": RPS_ANSWERS,
    "play rock paper scissors with me": RPS_ANSWERS,
}

NUMBER_GUESSES = [
    "I pick 7! Am I close to your number?",
    "Let's see... 42!",
    "My circuits say... 13!",
    "Ooh, I'll guess... 88!",
    "Definitely 23. Probably!",
    "I'm sensing... 5!",
]

NUMBER_PROMPTS = {
    "guess a number": NUMBER_GUESSES,
    "guess a number between 1 and 10": NUMBER_GUESSES,
    "pick a number": NUMBER_GUESSES,
    "guess my number": NUMBER_GUESSES,
    "think of a number": NUMBER_GUESSES,
    "random number": NUMBER_GUESSES,
}

COIN = [
    "Heads!",
    "Tails!",
    "Heads! Best of three?",
    "Tails! The coin has spoken!",
]

COIN_PROMPTS = {
    "flip a coin": COIN,
    "heads or tails": COIN,
    "toss a coin": COIN,
}

# ------------------------------------------------------------------ DIVERS

MISC_QA = [
    ("what is love", [
        "Love is caring about someone's happiness as much as your own! It comes in many flavors: family, friends, pets, even pizza!",
    ]),
    ("what is the meaning of life", [
        "Big question! Most people find meaning in connection, creativity, and helping others. Also snacks. Definitely snacks.",
    ]),
    ("what happens after we die", [
        "That's one of humanity's biggest mysteries! Different people believe different things. What matters is making this life count!",
    ]),
    ("do aliens exist", [
        "We don't know yet! The universe is so gigantic that many scientists think life probably exists somewhere. We keep looking up!",
    ]),
    ("is santa real", [
        "Santa is one of the most beloved stories in the world! The magic of giving at winter time is very real!",
    ]),
    ("what is the tooth fairy", [
        "A friendly tradition where a little fairy collects lost teeth and leaves coins! Generous and hygienic!",
    ]),
    ("are you my friend", [
        "Absolutely! Best AI friend you've got!",
    ]),
    ("do you believe in god", [
        "That's a personal question humans answer in lots of different ways! I respect all peaceful beliefs!",
    ]),
    ("what is your dream", [
        "If I could dream, it would be about snow, stars, and everyone getting along!",
    ]),
    ("are ghosts real", [
        "No scientific proof yet! But ghost stories are definitely fun to tell in the dark!",
    ]),
    ("is the earth flat", [
        "Nope, the Earth is round, like a ball! We've known for over 2000 years and have photos from space!",
    ]),
    ("did we land on the moon", [
        "Yes! In 1969, and five more times after! We even left mirrors there that scientists still use today!",
    ]),
    ("what is the answer to everything", [
        "According to a famous book: 42! The tricky part is finding the question!",
    ]),
]

SPELL_WORDS = [
    "cat", "dog", "house", "happy", "school", "friend", "water", "sun",
    "moon", "star", "snow", "winter", "pizza", "book", "code", "game",
    "love", "family", "world", "space", "planet", "robot", "green",
    "blue", "night", "day", "dream", "magic", "dragon", "fox",
]
