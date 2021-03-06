const express = require("express");
const path = require("path");
const db = require("./config/connection");
const cors = require("cors");
const { ApolloServer } = require("apollo-server-express");
const { authMiddleware } = require("./utils/auth");
const { typeDefs, resolvers } = require("./schema");

const PORT = process.env.PORT || 3001;
const app = express();

const server = new ApolloServer({
    typeDefs,
    resolvers,
    // Add context to our server so data from the `authMiddleware()` function can pass data to our resolver functions
    context: authMiddleware,
});
server.start().then(() => {
    server.applyMiddleware({ app });
});

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());



//debug how node will work in prod using http://localhost:3001
app.use(express.static(path.join(__dirname, "../client/build")));
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname + "../../client/build/index.html"));
});

//start server and listen
db.once("open", () => {
    app.listen(PORT, () => {
        console.log(`API server running on port ${PORT}!`);
        console.log(
            `Use GraphQL at http://localhost:${PORT}${server.graphqlPath}`
        );
    });
});
