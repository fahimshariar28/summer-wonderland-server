const express = require("express");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }
  // bearer token
  const token = authorization.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.kf4yrvq.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const classesCollection = client
      .db("summer-wonderland")
      .collection("classes");
    const usersCollection = client.db("summer-wonderland").collection("users");
    const selectedClassCollection = client
      .db("summer-wonderland")
      .collection("selectedClass");
    const paymentCollection = client
      .db("summer-wonderland")
      .collection("payment");

    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });

      res.send({ token });
    });

    // verify admin jwt
    const verifyAdminJWT = (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = usersCollection.findOne(query);
      if (user?.role !== "admin") {
        return res
          .status(401)
          .send({ error: true, message: "unauthorized access" });
      }
      next();
    };

    // Add users to the database
    app.post("/adduser", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: "user already exists" });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // Get all classes
    app.get("/classes", async (req, res) => {
      const query = { status: "approved" };
      const result = await classesCollection.find(query).toArray();
      res.send(result);
    });

    // Get classes data on enrolled descending order
    app.get("/popularClasses", async (req, res) => {
      const query = { status: "approved" };
      const options = { sort: { enrolled: -1 } };
      const result = await classesCollection
        .find(query, options)
        .limit(6)
        .toArray();
      res.send(result);
    });

    // Get Instructors from the database
    app.get("/instructors", async (req, res) => {
      const query = { role: "instructor" };
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // Get Popular Instructors from the database
    app.get("/popularInstructors", async (req, res) => {
      const query = { role: "instructor" };
      const options = { sort: { students: -1 } };
      const result = await usersCollection
        .find(query, options)
        .limit(6)
        .toArray();
      res.send(result);
    });

    // Check if user is a student
    app.get("/isStudent/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({ student: false });
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = { student: user?.role === "student" };
      res.send(result);
    });

    // Check if user is an instructor
    app.get("/isInstructor/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({ instructor: false });
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = { instructor: user?.role === "instructor" };
      res.send(result);
    });

    // Check if user is an admin
    app.get("/isAdmin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({ admin: false });
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = { admin: user?.role === "admin" };
      res.send(result);
    });

    // Post selected class to the database
    app.post("/selectClass", async (req, res) => {
      const selectClass = req.body;
      const result = await selectedClassCollection.insertOne(selectClass);
      res.send(result);
    });

    // Get selected class from the database by email
    app.get("/selectedClass", verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (!email) return res.send([]);

      if (req.decoded.email !== email) {
        return res
          .status(403)
          .send({ error: true, message: "forbidden access" });
      }

      // Delete Selected Class
      app.delete("/deleteSelectedClass/:id", verifyJWT, async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await selectedClassCollection.deleteOne(query);
        res.send(result);
      });

      const query = { email: email };
      const result = await selectedClassCollection.find(query).toArray();
      res.send(result);
    });

    // Crete payment intent
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const { classPrice } = req.body;
      const amount = classPrice * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // Post payment to the database
    app.post("/payment", verifyJWT, async (req, res) => {
      const payment = req.body;
      const insertResult = await paymentCollection.insertOne(payment);

      const deleteQuery = {
        _id: new ObjectId(payment.selectedClassId),
      };
      const deleteResult = await selectedClassCollection.deleteOne(deleteQuery);

      const updateQuery = {
        _id: new ObjectId(payment.classId),
      };
      const updateResult = await classesCollection.updateOne(updateQuery, {
        $inc: { enrolled: 1 },
      });

      const updateSeatsQuery = {
        _id: new ObjectId(payment.classId),
      };
      const updateSeatsResult = await classesCollection.updateOne(
        updateSeatsQuery,
        {
          $inc: { available_seats: -1 },
        }
      );

      const classId = payment.classId;
      const query = { _id: new ObjectId(classId) };

      const classData = await classesCollection.findOne(query);
      const instructorEmail = classData.email;

      const updateInstructorQuery = { email: instructorEmail };

      // if instructor has no students field, create one
      const updateInstructorResult = await usersCollection.updateOne(
        updateInstructorQuery,
        {
          $inc: { students: 1 },
        }
      );

      res.send({
        insertResult,
        deleteResult,
        updateResult,
        updateSeatsResult,
        updateInstructorResult,
      });
    });

    // Get paid classes from the database by email
    app.get("/paidClasses", verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.send([]);
      }

      if (req.decoded.email !== email) {
        return res
          .status(403)
          .send({ error: true, message: "forbidden access" });
      }

      const query = { email: email };
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    // Admin Routes
    // Get all users
    app.get("/users", verifyJWT, verifyAdminJWT, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Summer Wonderland is running");
});

app.listen(port, () => {
  console.log(`Summer Wonderland running at:${port}`);
});
