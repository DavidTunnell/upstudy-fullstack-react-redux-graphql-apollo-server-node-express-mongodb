import { Link } from "react-router-dom";
import { useEffect } from "react";
import { useMutation } from "@apollo/client";
import { ADD_EMAIL_VERIFICATION_TOKEN } from "../utils/mutations";
const VerifyEmail = () => {
    const styles = {
        notFoundStyle: {
            backgroundImage: "url(./assets/images/verify-bg.jpg)",
        },
    };
    const [addEmailVerificationToken] = useMutation(
        ADD_EMAIL_VERIFICATION_TOKEN
    );
    //http://localhost:3000/verify?name=ferret&color=purple
    const search = window.location.search;
    //if invalid send to 404 or let them know? let them know..
    const params = new URLSearchParams(search);

    let createdEmail = params.get("email");
    let createdToken = params.get("token");
    let userId = params.get("id");

    // console.log(createdEmail + " | " + createdToken + " | " + createdTokenId);

    useEffect(() => {
        const generateVerificationEmail = async (id) => {
            const { data } = await addEmailVerificationToken({
                variables: {
                    userId: id,
                },
            });
            console.log(data);
        };

        generateVerificationEmail(userId);
    }, []);

    return (
        <>
            <div className="viewport">
                <div
                    className="image image-overlay image-blur"
                    style={styles.notFoundStyle}
                ></div>
                <div className="container">
                    <div className="row justify-content-center align-items-center vh-100">
                        <div className="col-md-6 col-lg-4 text-white text-center">
                            <h1>Check your email</h1>
                            <p>
                                Click the link to verify your email address. You
                                can continue to use the site but will be
                                prompted to verify your email address each time
                                you sign in.
                            </p>
                            <p>
                                {/* add buttons here to return home and resend email validation link 
                                also add use error for mutation calls in login line on https://i.imgur.com/YSTWiYb.png
                                loading also works for mutation calls
                                -consider using cache for better performance (reduces db calls)- https://i.imgur.com/kjEpUyZ.png - https://i.imgur.com/TPKx3lO.png
                                -also, use parameters in routes to pass certain types of data - https://i.imgur.com/B0Po9kF.png
                                */}
                                <div className="mt-3">
                                    <Link
                                        to="/"
                                        target="_blank"
                                        // download
                                    >
                                        <button
                                            className="btn btn-white mr-1 mb-1"
                                            type="button"
                                        >
                                            Resend Email
                                        </button>
                                    </Link>
                                    <Link to="/">
                                        <button
                                            className="btn btn-white mr-1 mb-1"
                                            type="button"
                                        >
                                            Go Home
                                        </button>
                                    </Link>
                                </div>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};

export default VerifyEmail;