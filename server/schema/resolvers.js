const { AuthenticationError } = require("apollo-server-express");
const {
    User,
    TokenEmailVerification,
    Subject,
    BetaFeedback,
    Bookmark,
} = require("../models");
const { signToken } = require("../utils/auth");
const bcrypt = require("bcrypt");
const {
    generateToken,
    generateVerificationEmailOptions,
    generatePasswordResetEmailOptions,
    sendEmail,
    generatePassword,
} = require("../utils/email");
const s3 = require("../utils/s3");
const { getGraphQLRateLimiter } = require("graphql-rate-limit");

const rateLimiter = getGraphQLRateLimiter({ identifyContext: (ctx) => ctx.id });

const resolvers = {
    Query: {
        users: async () => {
            return User.find();
        },
        user: async (parent, { userId }) => {
            return User.findOne({ _id: userId });
        },
        subjects: async (obj, args, context) => {
            //get categories/subjects sorted by date ASC
            const sortBy = {};
            if (args.sortBy) {
                sortBy[args.sortBy.field] =
                    args.sortBy.order === "ASC" ? 1 : -1;
            }
            return await Subject.find({}).sort(sortBy);
        },
        subject: async (parent, { subjectId }) => {
            return Subject.findOne({ _id: subjectId });
        },
        betaFeedback: async (obj, args, context) => {
            //get beta feedback sorted by date ASC
            const sortBy = {};
            if (args.sortBy) {
                sortBy[args.sortBy.field] =
                    args.sortBy.order === "ASC" ? 1 : -1;
            }
            return await BetaFeedback.find({}).sort(sortBy);
        },
        bookmarks: async (parent, { userId }) => {
            const user = await User.findOne({ _id: userId });
            return user.bookmarks.filter(function (bookmark) {
                return bookmark.archived == false;
            });
        },
    },
    Mutation: {
        addUser: async (parent, { username, email, password }) => {
            //https://stackoverflow.com/questions/4959975/generate-random-number-between-two-numbers-in-javascript
            function randomIntFromInterval(min, max) {
                // min and max included
                return Math.floor(Math.random() * (max - min + 1) + min);
            }
            //get url for random predefined profile pic
            const profilePic = `../../assets/images/default-profile-pics/default-profile-pic-${randomIntFromInterval(
                1,
                5
            )}.jpg`;
            //check if user with the credentials provided already exists
            const userCheck = await User.findOne({
                $or: [{ email }, { username }],
            });
            //if so let user know
            if (userCheck) {
                throw new AuthenticationError(
                    "An account with that email or username already exists. Please try again."
                );
            } else {
                //otherwise create the new user, and a sign in token and return it
                const user = await User.create({
                    username,
                    email,
                    password,
                    profilePic,
                });
                const token = signToken(user);
                return { token, user };
            }
        },
        addSubject: async (
            parent,
            { name, description, image, bgColor, createdBy },
            context
        ) => {
            if (context.user) {
                //check if subject already exists
                const subjectCheck = await Subject.findOne({ name });
                //if so let user know
                if (subjectCheck) {
                    throw new AuthenticationError(
                        "A subject with this name already exists."
                    );
                } else {
                    //otherwise create the new subject and return it
                    const subject = await Subject.create({
                        name,
                        description,
                        image,
                        bgColor,
                        createdBy,
                        path: name.toLowerCase().replace(/\s/g, "-"),
                    });
                    return subject;
                }
            }
        },
        addBetaFeedback: async (
            parent,
            { username, email, category, message, image },
            context,
            info
        ) => {
            //create feedback document
            try {
                const betaFeedback = await BetaFeedback.create({
                    username,
                    email,
                    category,
                    message,
                    image,
                    archived: false,
                });
                return betaFeedback;
            } catch (error) {
                throw new AuthenticationError(error.message);
            }
        },
        archiveBetaFeedback: async (parent, { feedbackId }, context, info) => {
            //find with ID and update archive field
            try {
                const feedback = await BetaFeedback.findOne({
                    _id: feedbackId,
                });
                if (feedback) {
                    feedback.archived = true;
                    feedback.save();
                }
                return feedback;
            } catch (error) {
                throw new AuthenticationError(error.message);
            }
        },
        archiveBookmark: async (
            parent,
            { userId, bookmarkId },
            context,
            info
        ) => {
            //find with ID and update archive field
            try {
                //its nows updating but the 1st one not the one found via bookmark...
                var user = await User.findOneAndUpdate(
                    {
                        _id: userId,
                        "bookmarks._id": bookmarkId,
                    },
                    { $set: { "bookmarks.$.archived": "true" } }
                );
                return user;
            } catch (error) {
                throw new AuthenticationError(error.message);
            }
        },
        unarchiveBookmark: async (
            parent,
            { userId, categoryId },
            context,
            info
        ) => {
            //find with ID and update archive field
            try {
                //its nows updating but the 1st one not the one found via bookmark...
                var user = await User.findOneAndUpdate(
                    {
                        _id: userId,
                        "bookmarks.categoryId": categoryId,
                    },
                    { $set: { "bookmarks.$.archived": "false" } }
                );
                return user;
            } catch (error) {
                throw new AuthenticationError(error.message);
            }
        },
        updateProfilePic: async (
            parent,
            { userId, profilePic },
            context,
            info
        ) => {
            //confirm they are authenticateds
            if (context.user) {
                //user model update
                const user = await User.findOne({ _id: userId });
                //if the user doesn't exist let user know
                if (!user) {
                    throw new AuthenticationError(
                        "This user id doesn't exist. Which is pretty weird."
                    );
                }
                try {
                    //update profile pic in db
                    user.profilePic = profilePic;
                    await user.save();
                    return user;
                } catch (error) {
                    throw new AuthenticationError(error.message);
                }
            }
            throw new AuthenticationError(
                "You must be logged in to perform this action."
            );
        },
        addEmailVerificationToken: async (
            parent,
            { userId, username, email },
            context,
            info
        ) => {
            var args = { userId, username, email };
            //prevent users from doing this too frequently
            const errorMessage = await rateLimiter(
                { parent, args, context, info },
                {
                    max: 2,
                    window: "20s",
                    message: "You are doing that too often.",
                }
            );
            if (errorMessage) throw new AuthenticationError(errorMessage);
            //create a email verification token and associated user id
            const newUserEmailToken = generateToken(userId);
            //save it to mongodb
            try {
                newUserEmailToken.save();
            } catch (error) {
                throw new AuthenticationError(error.message);
            }
            // generate options for verification email
            const emailOptions = generateVerificationEmailOptions(
                username,
                email,
                newUserEmailToken,
                userId
            );
            //send email with options
            try {
                sendEmail(emailOptions);
                console.log("addEmailVerificationToken email sent");
            } catch (error) {
                console.log(error);
                throw new AuthenticationError(
                    "Failed to send email. Try again later!!\n\n" + error
                );
            }
        },
        verifyEmail: async (parent, { email, token }) => {
            //find the token associated with the email verification
            const tokenReturned = await TokenEmailVerification.findOne({
                token: token,
                expireAt: { $gt: new Date(Date.now() - 86400000) },
            });
            //if the token doesn't exist or has expired let user know
            if (!tokenReturned) {
                throw new AuthenticationError(
                    "This token doesn't exist or has expired."
                );
            }
            //get the associated user
            const userReturned = await User.findOne({
                token: token,
                email: email,
            });
            //if the user doesn't exist let user know
            if (!userReturned) {
                throw new AuthenticationError(
                    "There is no user associated with that token."
                );
            }
            //if both exist, verify email in mongodb
            userReturned.isVerified = true;
            var updatedUser = await userReturned.save();
            if (!updatedUser) {
                throw new AuthenticationError(
                    "There was an error verifying this email address."
                );
            }
            return { user: userReturned };
        },
        login: async (parent, { email, password }) => {
            //find user based on provided email
            const user = await User.findOne({ email });
            //if it doesn't exist, let the user know in a generic message to prevent giving too much info to malicious actors
            if (!user) {
                throw new AuthenticationError(
                    "If the user you entered exists, you entered the wrong username and/or password."
                );
            }
            //check if password for found user is correct
            const correctPw = await user.isCorrectPassword(password);
            //if not let user know
            if (!correctPw) {
                throw new AuthenticationError(
                    "If the user you entered exists, you entered the wrong username and/or password."
                );
            }
            console.log(user);
            //if both are found create a sign in token and pass it and the user data back to client
            const token = signToken(user);
            return { token, user };
        },
        forgotPassword: async (parent, { email }, context, info) => {
            var args = { email };
            const errorMessage = await rateLimiter(
                { parent, args, context, info },
                {
                    max: 1,
                    window: "10s",
                    message: "You are doing that too often.",
                }
            );
            if (errorMessage) throw new AuthenticationError(errorMessage);
            //generate a 10 character random password
            var newPw = generatePassword(10);
            //encrypt the new password for the database
            var encryptedPw = bcrypt.hashSync(newPw, 10);
            //find the user and update their passwords
            const user = await User.findOneAndUpdate(
                { email },
                { password: encryptedPw }
            );
            //if the user doesn't exist let user know
            if (!user) {
                throw new AuthenticationError(
                    "If the email you entered exists, you will be sent an email with a new password."
                );
            }
            //create email options for forgot password
            const emailOptions = generatePasswordResetEmailOptions(
                user.username,
                user.email,
                newPw
            );
            //send email with new password to user
            try {
                sendEmail(emailOptions);
                console.log("forgotPassword email sent");
            } catch (error) {
                console.log(error);
                throw new AuthenticationError(
                    "Failed to send email. Try again later. " + error
                );
            }
            return user;
        },
        updatePassword: async (
            parent,
            { email, oldPassword, newPassword },
            context
        ) => {
            //context (set in app.js on the client) shows there is a valid token associated with the user for security
            //checking the context has a user is server side validation that the login is valid, and should be used on all actions that require the user to be logged in
            if (context.user) {
                //find user by email
                const user = await User.findOne({ email });
                //if it doesn't exist let the user know (unlikely in this scenario)
                if (!user) {
                    throw new AuthenticationError(
                        "The email does not have a record associated with it."
                    );
                }
                //if the user exists confirm the existing password entered is correct
                const correctPw = await user.isCorrectPassword(oldPassword);
                //if not let user know
                if (!correctPw) {
                    throw new AuthenticationError(
                        "The existing password you entered is incorrect."
                    );
                }
                //the existing password is correct, so take the new one and encrypt it
                var encryptedPw = bcrypt.hashSync(newPassword, 10);
                //update database with new encrypted password
                const userUpdated = await User.findOneAndUpdate(
                    { email },
                    { password: encryptedPw }
                );
                //if no data was returned there was an error updating the password
                if (!userUpdated) {
                    throw new AuthenticationError(
                        "There was a problem updating your password."
                    );
                }
                return userUpdated;
            }
            throw new AuthenticationError(
                "You must be logged in to perform this action."
            );
        },
        getS3Url: async (parent, { isLoggedIn }) => {
            try {
                //upload image file and return the new s3 URL
                const url = s3.generateUploadURL();
                const isLoggedInCheck = isLoggedIn;
                return url;
            } catch (error) {
                throw new AuthenticationError(error.message);
            }
        },
        getS3UrlAuthenticated: async (parent, { isLoggedIn }, context) => {
            //ensure user is authenticated
            if (context.user && isLoggedIn) {
                try {
                    //upload image file and return the new s3 URL
                    const url = s3.generateUploadURL();
                    return url;
                } catch (error) {
                    throw new AuthenticationError(error.message);
                }
            } else {
                throw new AuthenticationError(
                    "You must be logged in to perform this action."
                );
            }
        },
        addBookmark: async (
            parent,
            { userId, categoryId, name, type, path }
        ) => {
            const bookmark = {
                categoryId,
                name,
                type,
                path,
                archived: false,
            };

            return User.findOneAndUpdate(
                { _id: userId },
                {
                    $addToSet: { bookmarks: bookmark },
                },
                {
                    new: true,
                    runValidators: true,
                }
            );
        },
        addBook: async (
            parent,
            { userId, authors, description, bookId, image, link, title }
        ) => {
            const book = {
                authors,
                description,
                bookId,
                image,
                link,
                title,
            };

            return User.findOneAndUpdate(
                { _id: userId },
                {
                    $addToSet: { savedBooks: book },
                },
                {
                    new: true,
                    runValidators: true,
                }
            );
        },
        removeUser: async (parent, { userId }) => {
            return User.findOneAndDelete({ _id: userId });
        },
        removeBook: async (parent, { userId, bookId }) => {
            return User.findOneAndUpdate(
                { _id: userId },
                { $pull: { savedBooks: { bookId: bookId } } },
                { new: true }
            );
        },
    },
};

module.exports = resolvers;
