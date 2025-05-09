import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import session from "express-session";
import env from "dotenv";


const app = express();
const port = 3000;
const saltRounds = 10;
env.config();


const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
});
db.connect();

app.use(session({
  secret: process.env.SESSION_SECRET, // Change this to something more secure
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set 'secure: true' in production with HTTPS
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.render("welcome.ejs");
});

app.get("/dashboard", async (req, res) => {
  const userId = req.session.userId;
  const selectedSkillId = req.query.skill_id;

  if (!userId) {
    return res.redirect("/login");
  }

  try {
    const userResult = await db.query("SELECT * FROM users WHERE user_id = $1", [userId]);
    const skillsResult = await db.query("SELECT * FROM skills WHERE user_id = $1", [userId]);

    let logsResult = { rows: [] };
    if (selectedSkillId) {
      logsResult = await db.query("SELECT * FROM logs WHERE skill_id = $1", [selectedSkillId]);
    }

    res.render("dashboard.ejs", {
      user: userResult.rows[0],
      skills: skillsResult.rows,
      logs: logsResult.rows,
      selectedSkillId: parseInt(selectedSkillId),
    });
  } catch (err) {
    console.error("Error loading dashboard:", err);
    res.status(500).send("Error loading dashboard.");
  }
});



app.get("/auth", (req, res) => {
  res.render("auth.ejs");
});


app.post("/register", async (req, res) => {
  const userName = req.body.username;
  const email = req.body.email;
  const password = req.body.password;

  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (checkResult.rows.length > 0) {
      res.send("Email already exists. Try logging in.");
    } else {
      // Hash the password before storing it
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error(err);
          return res.status(500).send("Error hashing password");
        } else {
          const result = await db.query(
            "INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING user_id",
            [userName, email, hash]
          );
          console.log(result);

          const newUser = result.rows[0]; // user_id will be returned
          req.session.userId = newUser.user_id;
          res.render("dashboard.ejs", {
            user: newUser,
            skills: [],
            logs: [],
            selectedSkillId: null
          });
          
        }
      });
    }
  } catch (err) {
    console.log(err);
  }
});


app.post("/login", async (req, res) => {
  const email = req.body.email;
  const loginPassword = req.body.password;

  try {
    const result = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      const storedHashedPassword = user.password;

      bcrypt.compare(loginPassword, storedHashedPassword, async (err, result) => {
        if (err) {
          console.error(err);
          return res.status(500).send("Error comparing passwords");
        } else {
          // Passwords match
          if (result) {
            const userId = user.user_id; // Use the correct column name
            req.session.userId = userId; // Store user_id in session

            const skillResult = await db.query(
              "SELECT * FROM skills WHERE user_id = $1",
              [userId]
            );

            const logResult = await db.query(
              "SELECT * FROM logs WHERE skill_id IN (SELECT skill_id FROM skills WHERE user_id = $1)",
              [userId]
            );
            
            res.render("dashboard.ejs", {
              user: user,
              skills: skillResult.rows,
              logs: logResult.rows,
              selectedSkillId: null
            });
          } else {
            res.send("Incorrect Password");
          }
        }
      });
    } else {
      res.send("User not found");
    }
  } catch (err) {
    console.log(err);
  }
});



app.post("/add-skill", async (req, res) => {
  const { skill } = req.body; // No need for userId from body
  const userId = req.session.userId; // Get userId from session

  if (!userId) {
    return res.status(401).send("Unauthorized: Please log in first.");
  }

  try {
    // Insert the new skill with the user_id from session
    await db.query(
      "INSERT INTO skills (skill_name, user_id) VALUES ($1, $2)",
      [skill, userId]
    );

    // Fetch the updated skill list for the user
    const skillResult = await db.query(
      "SELECT * FROM skills WHERE user_id = $1",
      [userId]
    );

    res.render("dashboard.ejs", {
      user: { user_id: userId }, // Pass userId to the view
      skills: skillResult.rows,
      logs: [],
      selectedSkillId: null 
    });
  } catch (err) {
    console.error("Error adding skill:", err);
    res.status(500).send("An error occurred while adding the skill.");
  }
});

app.post("/add-log", async (req, res) => {
  const { content, skill_id } = req.body;

  try {
    const userId = req.session.userId;

    const skillResult = await db.query(
      "SELECT * FROM skills WHERE skill_id = $1 AND user_id = $2",
      [skill_id, userId]
    );

    if (skillResult.rows.length > 0) {
      await db.query(
        "INSERT INTO logs (skill_id, content, created_at) VALUES ($1, $2, NOW())",
        [skill_id, content]
      );

      const logsResult = await db.query("SELECT * FROM logs WHERE skill_id = $1", [skill_id]);
      const userResult = await db.query("SELECT * FROM users WHERE user_id = $1", [userId]);
      const skillsResult = await db.query("SELECT * FROM skills WHERE user_id = $1", [userId]);

      res.render("dashboard.ejs", {
        user: userResult.rows[0],
        skills: skillsResult.rows,
        logs: logsResult.rows,
        selectedSkillId: parseInt(skill_id) || null, // ✅ Pass this to prevent EJS error
      });
    } else {
      res.status(400).send("Invalid skill ID or skill not associated with this user.");
    }
  } catch (err) {
    console.error("Error adding log:", err);
    res.status(500).send("An error occurred while adding the log.");
  }
});

app.post('/skill/edit/:id', (req, res) => {
  const { id } = req.params;
  const { newName } = req.body;

  db.query(
    'UPDATE skills SET skill_name = $1 WHERE skill_id = $2',
    [newName, id],
    (err, result) => {
      if (err) {
        console.error('DB Error:', err);
        return res.status(500).send('Error updating skill');
      }
      res.redirect('/dashboard');
    }
  );
});
app.post('/skill/delete/:id', (req, res) => {
  const { id } = req.params;

  db.query(
    'DELETE FROM skills WHERE skill_id = $1',
    [id],
    (err, result) => {
      if (err) {
        console.error('DB Error:', err);
        return res.status(500).send('Error deleting skill');
      }
      res.redirect('/dashboard');
    }
  );
});

app.post('/log/edit/:id', (req, res) => {

  console.log('Request Body:', req.body); 
  const { id } = req.params;
  const { newContent,skill_id } = req.body;

  console.log('Log ID:', id);
  console.log('New Content:', newContent);
  console.log('Skill ID:', skill_id);

  // Ensure id is an integer and newContent is not empty
  if (isNaN(id) || !newContent) {
    return res.status(400).send('Invalid data');
  }


  db.query(
    'UPDATE logs SET content = $1 WHERE log_id = $2',
    [newContent, id],
    (err, result) => {
      if (err) {
        console.error('DB Error:', err);
        return res.status(500).send('Error updating log');
      }
      res.redirect(`/dashboard?skill_id=${req.body.skill_id}`);
    }
  );
});

app.post('/log/delete/:id', (req, res) => {
  const { id } = req.params;

  db.query(
    'DELETE FROM logs WHERE log_id = $1',
    [id],
    (err, result) => {
      if (err) {
        console.error('DB Error:', err);
        return res.status(500).send('Error deleting log');
      }
      res.redirect(`/dashboard?skill_id=${req.body.skill_id}`);
    }
  );
});






app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.log(err);
      return res.status(500).send("Error logging out");
    }
    res.redirect("/auth");
  });
});



app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
