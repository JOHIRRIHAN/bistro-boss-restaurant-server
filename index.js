const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const stripe = require('stripe')(process.env.STEP_SECRET_KEY)
// console.log("step", stripe)
const app = express();
require("dotenv").config();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.USER_NAME}:${process.env.USER_PASSWORD}@cluster0.loknebs.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

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
    const userCollection = client.db("bistroDB").collection("user");
    const menuCollection = client.db("bistroDB").collection("menu");
    const reviewsCollection = client.db("bistroDB").collection("reviews");
    const cartCollection = client.db("bistroDB").collection("carts");
    const paymentCollection = client.db("bistroDB").collection("payments");

    // middle Ware
    const verifyToken = (req, res, next) => {
      // console.log("inside verify token", req.headers.authorization);
      if(!req.headers.authorization){ 
        return res.status(401).send({message: 'forbidden access 1'})
      }
      const token = req.headers.authorization.split(' ')[1];
      jwt.verify(token, process.env.Access_TOKEN_SECRET, (err, decoded)=>{
        if(err){
            return res.status(401).send({message: 'forbidden access'})
        }
        req.decoded = decoded
        next();
      })
    };

    const verifyAdmin = async(req, res, next)=>{
        const email = req.decoded.email;
        const query = {email: email};
        const user = await userCollection.findOne(query);
        const isAdmin = user?.role === 'admin';
        if(!isAdmin){
            return res.status(403).send({message: 'forbidden access'})
        }
    }

    // user related api
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });
    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.patch("/users/admin/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.get('/users/admin/:email', verifyToken, async(req, res)=>{
        const email = req.params.email;
        if(email !== req.decoded.email){
            return res.status(403).send({message: 'unauthorized access'})
        }
        const query = {email: email};
        const user = await userCollection.findOne(query);
        let admin = false;
        if(user){
            admin = user?.role === 'admin';
        }
        res.send({admin});
    })


    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.Access_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // menus API
    app.get("/menus", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });
    app.post('/menus', verifyToken, verifyAdmin, async(req, res)=>{
      const item = req.body;
      const result = await menuCollection.insertOne(item);
      res.send(result);
    })
    app.delete('/menus/:id', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        console.log(`Deleting item with id: ${id}`);
        const query = { _id: new ObjectId(id) };
        const result = await menuCollection.deleteOne(query);
        console.log("Delete result:", result);
        
        if (result.deletedCount === 1) {
          res.status(200).send({ deletedCount: result.deletedCount });
        } else {
          res.status(404).send({ message: "Item not found" });
        }
      } catch (error) {
        console.error("Error deleting item:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    
    // review API
    app.get("/reviews", async (req, res) => {
      const result = await reviewsCollection.find().toArray();
      res.send(result);
    });

    // cart collection
    app.get("/carts", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });
    app.post("/carts", async (req, res) => {
      const cartItem = req.body;
      const result = await cartCollection.insertOne(cartItem);
      res.send(result);
    });
    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    // payment intent 
    app.post('/create-payment-intent', async(req, res)=>{
      const {price} = req.body;
      const amount = parseInt(price * 100);
      // console.log(amount)
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']

      });
      res.send({
        clientSecret: paymentIntent.client_secret
      })
    })


    app.get('/admin-stats', async(req, res)=>{
      const users = await userCollection.estimatedDocumentCount();
      const menuItem = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();

      const payments = await paymentCollection.find().toArray();
      console.log('payment', payments)
      const revenue = payments?.reduce((total , payments) => total + payments.price, 0);
      console.log("revenue", revenue)
      res.send({
        users,
        menuItem,
        orders,
        revenue
      });
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB! bistro boss"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World! bistro boss");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
