import Categories from "./Categories";
import HomeHero from "./HomeHero";
import SearchBar from "./SearchBar";
import useScrollToTop from "../utils/useScrollToTop";

const Home = (params) => {
    //param originates in app.js
    const mainColor = params.bgColor;
    //smooth scroll if on same page routing
    useScrollToTop();
    return (
        <div className="home">
            <HomeHero bgColor={mainColor} />
            <SearchBar />
            <Categories />
        </div>
    );
};

export default Home;
